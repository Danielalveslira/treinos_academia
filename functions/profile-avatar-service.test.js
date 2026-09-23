import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { initializeApp, getApps } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { createProfileAvatarService } from './profile-avatar-service.js'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
if (getApps().length === 0) initializeApp({ projectId: 'demo-treinos-functions-test' })
const db = getFirestore()

function FakeHttpsError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

const objects = new Map()
const bucket = {
  file(path) {
    return {
      async getMetadata() {
        const value = objects.get(path)
        if (!value) throw new Error('missing object')
        return [{ contentType: value.contentType, size: value.buffer.length }]
      },
      async download() {
        return [objects.get(path).buffer]
      },
      async delete() {
        objects.delete(path)
      },
    }
  },
}
const makeService = (now = Date.now) =>
  createProfileAvatarService({
    db,
    bucket,
    FieldValue,
    HttpsError: FakeHttpsError,
    inspectImage: async () => ({ width: 512, height: 512 }),
    now,
  })
const service = makeService()
let sequence = 0
const uid = () => `avatar_user_${Date.now()}_${sequence++}`

test('allocation replays return the pending media without consuming another slot', async () => {
  const userId = uid()
  await db.doc(`users/${userId}`).set({ role: 'user' })
  const first = await service.allocate(userId)
  const replay = await service.allocate(userId)
  assert.deepEqual(replay, first)
  assert.equal(
    (await db.doc(`users/${userId}`).get()).data().avatarAllocation.allocatedAt.length,
    1
  )
  assert.equal(
    (await db.collection('profileAvatarMedia').where('ownerId', '==', userId).get()).size,
    1
  )
})

test('allocation rejects the seventh new media in a moving hour', async () => {
  const userId = uid()
  await db.doc(`users/${userId}`).set({ role: 'user' })
  for (let index = 0; index < 6; index++) {
    const { mediaId } = await service.allocate(userId)
    await db.doc(`profileAvatarMedia/${mediaId}`).update({ state: 'active' })
  }
  await assert.rejects(service.allocate(userId), { code: 'resource-exhausted' })
  assert.equal(
    (await db.collection('profileAvatarMedia').where('ownerId', '==', userId).get()).size,
    6
  )
})

test('allocation frees exactly the slots that leave the moving window', async () => {
  const userId = uid()
  let clock = 1_000_000
  const limited = makeService(() => clock)
  await db.doc(`users/${userId}`).set({ role: 'user' })
  for (let index = 0; index < 6; index++) {
    const { mediaId } = await limited.allocate(userId)
    await db.doc(`profileAvatarMedia/${mediaId}`).update({ state: 'active' })
    clock += 1_000
  }
  await assert.rejects(limited.allocate(userId), { code: 'resource-exhausted' })
  clock = 1_000_000 + 60 * 60 * 1_000
  const seventh = await limited.allocate(userId)
  assert.ok(seventh.mediaId)
  await db.doc(`profileAvatarMedia/${seventh.mediaId}`).update({ state: 'active' })
  await assert.rejects(limited.allocate(userId), { code: 'resource-exhausted' })
})

test('concurrent allocation calls share one pending media and one quota slot', async () => {
  const userId = uid()
  await db.doc(`users/${userId}`).set({ role: 'user' })
  await db.doc(`users/${userId}`).set(
    {
      avatarAllocation: { allocatedAt: Array(5).fill(Date.now()) },
    },
    { merge: true }
  )
  const results = await Promise.all(Array.from({ length: 8 }, () => service.allocate(userId)))
  assert.equal(new Set(results.map((result) => result.mediaId)).size, 1)
  assert.equal(
    (await db.doc(`users/${userId}`).get()).data().avatarAllocation.allocatedAt.length,
    6
  )
  assert.equal(
    (await db.collection('profileAvatarMedia').where('ownerId', '==', userId).get()).size,
    1
  )
})

test('global avatar allocation, confirmation and removal update private and public profiles', async () => {
  const userId = uid()
  await db.doc(`users/${userId}`).set({ role: 'user' })
  await db
    .doc(`publicProfiles/${userId}`)
    .set({ username: 'avatar', bio: null, shareStatistics: false })
  const allocation = await service.allocate(userId)
  objects.set(allocation.path, { contentType: 'image/webp', buffer: Buffer.from('valid-webp') })
  await service.confirm(userId, { mediaId: allocation.mediaId })
  assert.equal((await db.doc(`users/${userId}`).get()).data().avatarPath, allocation.path)
  assert.equal((await db.doc(`publicProfiles/${userId}`).get()).data().avatarPath, allocation.path)

  await service.remove(userId)
  assert.equal((await db.doc(`users/${userId}`).get()).data().avatarPath, undefined)
  assert.equal((await db.doc(`publicProfiles/${userId}`).get()).data().avatarPath, undefined)
  assert.equal(objects.has(allocation.path), false)
})

test('removing the global avatar immediately revokes its approved storefront copy', async () => {
  const userId = uid()
  const listingId = `listing_${Date.now()}_${sequence++}`
  const mediaId = db.collection('profileAvatarMedia').doc().id
  const profilePath = `profileAvatars/${userId}/${mediaId}.webp`
  await db
    .doc(`users/${userId}`)
    .set({ role: 'user', avatarMediaId: mediaId, avatarPath: profilePath })
  await db.doc(`publicProfiles/${userId}`).set({
    username: 'avatar',
    bio: null,
    shareStatistics: false,
    avatarMediaId: mediaId,
    avatarPath: profilePath,
  })
  await db.doc(`profileAvatarMedia/${mediaId}`).set({ ownerId: userId, state: 'active' })
  await db.doc(`professionalListingOwnerLocks/${userId}`).set({ ownerId: userId, listingId })
  const approvedPath = `professionalListingMedia/${listingId}/approved/BBBBBBBBBBBBBBBBBBBB.webp`
  await db
    .doc(`publishedProfessionalListings/${listingId}`)
    .set({ publicationStatus: 'published', avatarPath: approvedPath, avatarSourceMediaId: mediaId })
  objects.set(profilePath, { contentType: 'image/webp', buffer: Buffer.from('source') })
  objects.set(approvedPath, { contentType: 'image/webp', buffer: Buffer.from('copy') })

  await service.remove(userId)
  const storefront = await db.doc(`publishedProfessionalListings/${listingId}`).get()
  assert.equal(storefront.data().avatarPath, undefined)
  assert.equal(objects.has(approvedPath), false)
})

test('replacing an avatar preserves the version pinned by a pending review until it is released', async () => {
  const userId = uid()
  const listingId = `listing_${Date.now()}_${sequence++}`
  const firstMediaId = db.collection('profileAvatarMedia').doc().id
  const firstPath = `profileAvatars/${userId}/${firstMediaId}.webp`
  await db.doc(`users/${userId}`).set({
    role: 'user',
    avatarMediaId: firstMediaId,
    avatarPath: firstPath,
  })
  await db.doc(`publicProfiles/${userId}`).set({
    username: 'avatar',
    bio: null,
    shareStatistics: false,
    avatarMediaId: firstMediaId,
    avatarPath: firstPath,
  })
  await db.doc(`profileAvatarMedia/${firstMediaId}`).set({
    ownerId: userId,
    storagePath: firstPath,
    state: 'active',
    createdAt: new Date(0),
  })
  await db.doc(`professionalListingOwnerLocks/${userId}`).set({ ownerId: userId, listingId })
  await db.doc(`professionalListingDrafts/${listingId}`).set({
    ownerId: userId,
    reviewState: 'pending_review',
    useProfileAvatar: true,
    submittedAvatarMediaId: firstMediaId,
    submittedAvatarPath: firstPath,
  })
  objects.set(firstPath, { contentType: 'image/webp', buffer: Buffer.from('first') })

  const replacement = await service.allocate(userId)
  objects.set(replacement.path, { contentType: 'image/webp', buffer: Buffer.from('second') })
  await service.confirm(userId, { mediaId: replacement.mediaId })
  assert.equal(objects.has(firstPath), true)

  await service.purgeExpired(Date.now())
  assert.equal(objects.has(firstPath), true)
  assert.equal((await db.doc(`profileAvatarMedia/${firstMediaId}`).get()).exists, true)

  await db.doc(`professionalListingDrafts/${listingId}`).update({ reviewState: 'draft' })
  await service.purgeExpired(Date.now())
  assert.equal(objects.has(firstPath), false)
  assert.equal((await db.doc(`profileAvatarMedia/${firstMediaId}`).get()).exists, false)
})

test('removing the personal avatar revokes a pending storefront avatar authorization', async () => {
  const userId = uid()
  const listingId = `listing_${Date.now()}_${sequence++}`
  const mediaId = db.collection('profileAvatarMedia').doc().id
  const profilePath = `profileAvatars/${userId}/${mediaId}.webp`
  await db.doc(`users/${userId}`).set({
    role: 'user',
    avatarMediaId: mediaId,
    avatarPath: profilePath,
  })
  await db.doc(`publicProfiles/${userId}`).set({
    username: 'avatar',
    bio: null,
    shareStatistics: false,
    avatarMediaId: mediaId,
    avatarPath: profilePath,
  })
  await db.doc(`profileAvatarMedia/${mediaId}`).set({
    ownerId: userId,
    storagePath: profilePath,
    state: 'active',
  })
  await db.doc(`professionalListingOwnerLocks/${userId}`).set({ ownerId: userId, listingId })
  await db.doc(`professionalListingDrafts/${listingId}`).set({
    ownerId: userId,
    reviewState: 'pending_review',
    useProfileAvatar: true,
    submittedAvatarMediaId: mediaId,
    submittedAvatarPath: profilePath,
  })
  objects.set(profilePath, { contentType: 'image/webp', buffer: Buffer.from('source') })

  await service.remove(userId)

  const draft = (await db.doc(`professionalListingDrafts/${listingId}`).get()).data()
  assert.equal(draft.useProfileAvatar, false)
  assert.equal(draft.submittedAvatarMediaId, undefined)
  assert.equal(draft.submittedAvatarPath, undefined)
  assert.equal(objects.has(profilePath), false)
})

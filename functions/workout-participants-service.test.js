import { test } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createListWorkoutParticipants } from './workout-participants-service.js'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
initializeApp({ projectId: 'demo-treinos-workout-participants-test' })
const db = getFirestore()

function FakeHttpsError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function buildService({ now } = {}) {
  return createListWorkoutParticipants({
    db,
    Timestamp,
    HttpsError: FakeHttpsError,
    ...(now ? { now } : {}),
  })
}

let counter = 0
function id(prefix) {
  return `${prefix}-${Date.now()}-${counter++}`
}

async function seedMembership(communityId, uid) {
  await db.doc(`communityMembers/${communityId}_${uid}`).set({ communityId, userId: uid })
}
async function seedUser(uid, data = {}) {
  await db.doc(`users/${uid}`).set(data)
}
async function seedWorkoutStatus(statusId, communityId) {
  await db.doc(`statuses/${statusId}`).set({ authorId: 'author1', communityId, type: 'workout' })
}
async function seedNonWorkoutStatus(statusId, communityId) {
  await db.doc(`statuses/${statusId}`).set({ authorId: 'author1', communityId, type: 'text' })
}
async function seedCommunityRestriction(communityId, uid) {
  await db
    .doc(`communityRestrictions/${communityId}_${uid}`)
    .set({ communityId, userId: uid, action: 'community_ban' })
}
async function seedParticipant(statusId, userId, joinedAtMs) {
  await db
    .doc(`statuses/${statusId}/participants/${userId}`)
    .set({ userId, joinedAt: Timestamp.fromMillis(joinedAtMs) })
}

test('lists participants with sanitized public data (userId + username only)', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('caller')
  await seedMembership(communityId, uid)
  await seedWorkoutStatus(statusId, communityId)
  await seedUser('participantA', { username: 'daniel', role: 'user', bio: 'segredo pessoal' })
  await seedParticipant(statusId, 'participantA', 1000)

  const service = buildService()
  const result = await service(uid, { statusId, cursor: null, limit: 20 })
  assert.deepEqual(result.participants, [{ userId: 'participantA', username: 'daniel' }])
  assert.equal(result.nextCursor, null)
  assert.deepEqual(Object.keys(result.participants[0]).sort(), ['userId', 'username'])
})

test('rejects listing participants of a status that is not a workout', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('caller')
  await seedMembership(communityId, uid)
  await seedNonWorkoutStatus(statusId, communityId)

  const service = buildService()
  await assert.rejects(
    service(uid, { statusId, cursor: null, limit: 20 }),
    (error) => error.code === 'failed-precondition'
  )
})

test('a non-existent status is not-found', async () => {
  const service = buildService()
  await assert.rejects(
    service('u1', { statusId: 'never-existed', cursor: null, limit: 20 }),
    (error) => error.code === 'not-found'
  )
})

test('validates statusId before touching Firestore', async () => {
  const service = buildService()
  await assert.rejects(
    service('u1', { statusId: '', cursor: null, limit: 20 }),
    (error) => error.code === 'invalid-argument'
  )
})

test('a user with no membership in the community cannot list participants', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('outsider')
  await seedWorkoutStatus(statusId, communityId)
  await seedUser(uid, { role: 'user' })

  const service = buildService()
  await assert.rejects(
    service(uid, { statusId, cursor: null, limit: 20 }),
    (error) => error.code === 'permission-denied'
  )
})

test('a member banned from the community cannot list participants, even with communityMembers still present', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('banned')
  await seedMembership(communityId, uid)
  await seedCommunityRestriction(communityId, uid)
  await seedWorkoutStatus(statusId, communityId)

  const service = buildService()
  await assert.rejects(
    service(uid, { statusId, cursor: null, limit: 20 }),
    (error) => error.code === 'permission-denied'
  )
})

test('a superadmin can list participants even without being a member of the community', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('admin')
  await seedWorkoutStatus(statusId, communityId)
  await seedUser(uid, { role: 'superadmin' })
  await seedUser('participantA', { username: 'daniel' })
  await seedParticipant(statusId, 'participantA', 1000)

  const service = buildService()
  const result = await service(uid, { statusId, cursor: null, limit: 20 })
  assert.deepEqual(result.participants, [{ userId: 'participantA', username: 'daniel' }])
})

test('pagination: a full page returns nextCursor, ordered by joinedAt, no repeats or gaps across pages', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('caller')
  await seedMembership(communityId, uid)
  await seedWorkoutStatus(statusId, communityId)
  const participantIds = Array.from({ length: 5 }, (_, index) => `participant${index}`)
  await Promise.all(participantIds.map((pid) => seedUser(pid, { username: pid })))
  await Promise.all(
    participantIds.map((pid, index) => seedParticipant(statusId, pid, 1000 + index))
  )

  const service = buildService()
  const firstPage = await service(uid, { statusId, cursor: null, limit: 2 })
  assert.deepEqual(
    firstPage.participants.map((p) => p.userId),
    ['participant0', 'participant1']
  )
  assert.ok(firstPage.nextCursor)

  const secondPage = await service(uid, { statusId, cursor: firstPage.nextCursor, limit: 2 })
  assert.deepEqual(
    secondPage.participants.map((p) => p.userId),
    ['participant2', 'participant3']
  )
  assert.ok(secondPage.nextCursor)

  const thirdPage = await service(uid, { statusId, cursor: secondPage.nextCursor, limit: 2 })
  assert.deepEqual(
    thirdPage.participants.map((p) => p.userId),
    ['participant4']
  )
  assert.equal(thirdPage.nextCursor, null)
})

test('no participants yet returns an empty list, not an error', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('caller')
  await seedMembership(communityId, uid)
  await seedWorkoutStatus(statusId, communityId)

  const service = buildService()
  const result = await service(uid, { statusId, cursor: null, limit: 20 })
  assert.deepEqual(result.participants, [])
  assert.equal(result.nextCursor, null)
})

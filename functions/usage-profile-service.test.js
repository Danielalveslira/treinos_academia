import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp, getApps } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { createUsageProfileService } from './usage-profile-service.js'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
if (getApps().length === 0) initializeApp({ projectId: 'demo-treinos-functions-test' })
const db = getFirestore()

function FakeHttpsError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

const service = createUsageProfileService({ db, FieldValue, HttpsError: FakeHttpsError })
let sequence = 0
const unique = (prefix) => `${prefix}_${Date.now()}_${sequence++}`

async function seedUser(uid, data = {}) {
  await db.doc(`users/${uid}`).set({ role: 'user', ...data })
}

async function seedListing(uid, { lifecycleState = 'published', kind = 'professional' } = {}) {
  const listingId = db.collection('professionalListings').doc().id
  await Promise.all([
    db.doc(`professionalListingOwnerLocks/${uid}`).set({ ownerId: uid, listingId }),
    db.doc(`professionalListings/${listingId}`).set({ ownerId: uid, kind, lifecycleState }),
  ])
  return listingId
}

test('rejects a value outside the three declared options', async () => {
  const uid = unique('owner')
  await seedUser(uid)
  await assert.rejects(
    service.setUsageProfile(uid, { usageProfile: 'superadmin' }),
    (error) => error.code === 'invalid-argument'
  )
})

test('rejects for a disabled or deleting account', async () => {
  const disabled = unique('disabled')
  const deleting = unique('deleting')
  await Promise.all([
    seedUser(disabled, { accountStatus: 'disabled' }),
    seedUser(deleting),
    db.doc(`deletionJobs/account_${deleting}`).set({ startedAt: FieldValue.serverTimestamp() }),
  ])
  await assert.rejects(
    service.setUsageProfile(disabled, { usageProfile: 'common' }),
    (error) => error.code === 'failed-precondition'
  )
  await assert.rejects(
    service.setUsageProfile(deleting, { usageProfile: 'common' }),
    (error) => error.code === 'failed-precondition'
  )
})

test('sets each of the three values for an account with no listing at all', async () => {
  const uid = unique('owner')
  await seedUser(uid)
  for (const usageProfile of ['common', 'professional', 'establishment_owner']) {
    const result = await service.setUsageProfile(uid, { usageProfile })
    assert.equal(result.usageProfile, usageProfile)
    assert.equal((await db.doc(`users/${uid}`).get()).data().usageProfile, usageProfile)
  }
})

test('switching between professional and establishment_owner is always free, even with a live listing', async () => {
  const uid = unique('owner')
  await seedUser(uid, { usageProfile: 'professional' })
  await seedListing(uid, { lifecycleState: 'published' })
  await assert.doesNotReject(service.setUsageProfile(uid, { usageProfile: 'establishment_owner' }))
  assert.equal(
    (await db.doc(`users/${uid}`).get()).data().usageProfile,
    'establishment_owner'
  )
})

test('blocks switching to common while a draft, legacy pending_review, or published listing is active', async () => {
  for (const lifecycleState of ['draft', 'pending_review', 'published']) {
    const uid = unique(`owner_${lifecycleState}`)
    await seedUser(uid, { usageProfile: 'professional' })
    await seedListing(uid, { lifecycleState })
    await assert.rejects(
      service.setUsageProfile(uid, { usageProfile: 'common' }),
      (error) => error.code === 'failed-precondition' && /vitrine ativa/.test(error.message)
    )
    assert.equal((await db.doc(`users/${uid}`).get()).data().usageProfile, 'professional')
  }
})

test('allows switching to common once the listing is archived, suspended, or gone -- the owner is never trapped', async () => {
  for (const lifecycleState of ['archived', 'suspended', 'deleting']) {
    const uid = unique(`owner_${lifecycleState}`)
    await seedUser(uid, { usageProfile: 'professional' })
    await seedListing(uid, { lifecycleState })
    await assert.doesNotReject(service.setUsageProfile(uid, { usageProfile: 'common' }))
  }
  const noListing = unique('owner_no_listing')
  await seedUser(noListing, { usageProfile: 'professional' })
  await assert.doesNotReject(service.setUsageProfile(noListing, { usageProfile: 'common' }))
})

test('a legacy account declaring for the very first time is checked the same way as a later change', async () => {
  const uid = unique('legacy')
  // Nunca teve o campo -- não é o mesmo que já ter sido "professional" antes.
  await db.doc(`users/${uid}`).set({ role: 'user' })
  await seedListing(uid, { lifecycleState: 'published' })
  await assert.rejects(
    service.setUsageProfile(uid, { usageProfile: 'common' }),
    (error) => error.code === 'failed-precondition'
  )
  await assert.doesNotReject(service.setUsageProfile(uid, { usageProfile: 'professional' }))
})

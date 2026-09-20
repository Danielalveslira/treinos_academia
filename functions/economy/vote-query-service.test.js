import { test } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createListPostEconomyVoters, resolvePostAccessDenialReason } from './vote-query-service.js'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
initializeApp({ projectId: 'demo-treinos-vote-query-test' })
const db = getFirestore()

function FakeHttpsError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function buildService({ now } = {}) {
  return createListPostEconomyVoters({ db, Timestamp, HttpsError: FakeHttpsError, ...(now ? { now } : {}) })
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
async function seedStatus(statusId, communityId) {
  await db.doc(`statuses/${statusId}`).set({ authorId: 'author1', communityId })
}
async function seedCommunityRestriction(communityId, uid) {
  await db.doc(`communityRestrictions/${communityId}_${uid}`).set({ communityId, userId: uid, action: 'community_ban' })
}
async function seedAccountRestriction(uid, data) {
  await db.doc(`accountRestrictions/${uid}`).set(data)
}
async function seedCommunityDeletionJob(communityId) {
  await db.doc(`deletionJobs/community_${communityId}`).set({ state: 'pending' })
}
async function seedVote(statusId, voterId, value, firstChargedAtMs) {
  await db.doc(`statuses/${statusId}/economyVotes/${voterId}`).set({
    userId: voterId,
    authorId: 'author1',
    value,
    charged: true,
    firstChargedAt: Timestamp.fromMillis(firstChargedAtMs),
    updatedAt: Timestamp.fromMillis(firstChargedAtMs),
    rewardState: value === 1 ? 'pending' : 'ineligible',
    rewardPendingAt: value === 1 ? Timestamp.fromMillis(firstChargedAtMs) : null,
    rewardDayKey: value === 1 ? '2026-01-01' : null,
  })
}

test('lists only positive voters (value === 1), each with sanitized public data', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('caller')
  await seedMembership(communityId, uid)
  await seedStatus(statusId, communityId)
  await seedUser('voterA', { username: 'voter_a' })
  await seedVote(statusId, 'voterA', 1, 1000)

  const service = buildService()
  const result = await service(uid, { statusId, direction: 'positive', cursor: null, limit: 20 })
  assert.deepEqual(result.voters, [{ userId: 'voterA', username: 'voter_a' }])
  assert.equal(result.nextCursor, null)
})

test('lists only negative voters (value === -1), never mixing directions', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('caller')
  await seedMembership(communityId, uid)
  await seedStatus(statusId, communityId)
  await Promise.all([seedUser('voterPos'), seedUser('voterNeg', { username: 'voter_neg' })])
  await Promise.all([seedVote(statusId, 'voterPos', 1, 1000), seedVote(statusId, 'voterNeg', -1, 2000)])

  const service = buildService()
  const positive = await service(uid, { statusId, direction: 'positive', cursor: null, limit: 20 })
  const negative = await service(uid, { statusId, direction: 'negative', cursor: null, limit: 20 })
  assert.deepEqual(positive.voters.map((v) => v.userId), ['voterPos'])
  assert.deepEqual(negative.voters, [{ userId: 'voterNeg', username: 'voter_neg' }])
})

test('a removed vote (value: null) never appears in either list', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('caller')
  await seedMembership(communityId, uid)
  await seedStatus(statusId, communityId)
  await seedUser('voterRemoved')
  await seedVote(statusId, 'voterRemoved', null, 1000)

  const service = buildService()
  const positive = await service(uid, { statusId, direction: 'positive', cursor: null, limit: 20 })
  const negative = await service(uid, { statusId, direction: 'negative', cursor: null, limit: 20 })
  assert.deepEqual(positive.voters, [])
  assert.deepEqual(negative.voters, [])
})

test('a user with no membership in the post community, and not superadmin, cannot list voters', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('outsider')
  await seedStatus(statusId, communityId)
  await seedUser(uid, { role: 'user' })

  const service = buildService()
  await assert.rejects(
    service(uid, { statusId, direction: 'positive', cursor: null, limit: 20 }),
    (error) => error.code === 'permission-denied'
  )
})

test('a superadmin can list voters even without being a member of the community', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('admin')
  await seedStatus(statusId, communityId)
  await seedUser(uid, { role: 'superadmin' })
  await seedUser('voterA', { username: 'voter_a' })
  await seedVote(statusId, 'voterA', 1, 1000)

  const service = buildService()
  const result = await service(uid, { statusId, direction: 'positive', cursor: null, limit: 20 })
  assert.deepEqual(result.voters, [{ userId: 'voterA', username: 'voter_a' }])
})

// resolvePostAccessDenialReason -- puro, equivalente a isSignedIn()+isMember() em
// firestore.rules. O ponto central da auditoria: um membro banido não deve escapar só
// porque communityMembers ainda existe.
test('resolvePostAccessDenialReason: a banned community member is denied even though communityMembers still exists', () => {
  const reason = resolvePostAccessDenialReason({
    isSuperAdmin: false,
    accountStatus: 'active',
    accountRestriction: null,
    nowMs: 1000,
    communityDeletionJobExists: false,
    communityRestrictionExists: true,
    isCommunityMember: true,
  })
  assert.equal(reason, 'community_restricted')
})

test('resolvePostAccessDenialReason: a disabled account is denied', () => {
  const reason = resolvePostAccessDenialReason({
    isSuperAdmin: false,
    accountStatus: 'disabled',
    accountRestriction: null,
    nowMs: 1000,
    communityDeletionJobExists: false,
    communityRestrictionExists: false,
    isCommunityMember: true,
  })
  assert.equal(reason, 'account_disabled')
})

test('resolvePostAccessDenialReason: an active (non-expired) account restriction is denied; an expired temporary suspension is not', () => {
  const active = resolvePostAccessDenialReason({
    isSuperAdmin: false,
    accountStatus: 'active',
    accountRestriction: { action: 'system_ban', untilMs: null },
    nowMs: 1000,
    communityDeletionJobExists: false,
    communityRestrictionExists: false,
    isCommunityMember: true,
  })
  assert.equal(active, 'account_restricted')

  const expired = resolvePostAccessDenialReason({
    isSuperAdmin: false,
    accountStatus: 'active',
    accountRestriction: { action: 'temporary_suspension', untilMs: 500 },
    nowMs: 1000,
    communityDeletionJobExists: false,
    communityRestrictionExists: false,
    isCommunityMember: true,
  })
  assert.equal(expired, null)

  const stillActive = resolvePostAccessDenialReason({
    isSuperAdmin: false,
    accountStatus: 'active',
    accountRestriction: { action: 'temporary_suspension', untilMs: 2000 },
    nowMs: 1000,
    communityDeletionJobExists: false,
    communityRestrictionExists: false,
    isCommunityMember: true,
  })
  assert.equal(stillActive, 'account_restricted')
})

test('resolvePostAccessDenialReason: a community being deleted is denied even for a member', () => {
  const reason = resolvePostAccessDenialReason({
    isSuperAdmin: false,
    accountStatus: 'active',
    accountRestriction: null,
    nowMs: 1000,
    communityDeletionJobExists: true,
    communityRestrictionExists: false,
    isCommunityMember: true,
  })
  assert.equal(reason, 'community_unavailable')
})

test('resolvePostAccessDenialReason: not a member is denied', () => {
  const reason = resolvePostAccessDenialReason({
    isSuperAdmin: false,
    accountStatus: 'active',
    accountRestriction: null,
    nowMs: 1000,
    communityDeletionJobExists: false,
    communityRestrictionExists: false,
    isCommunityMember: false,
  })
  assert.equal(reason, 'not_a_member')
})

test('resolvePostAccessDenialReason: superadmin bypasses every check -- disabled account, active restriction, community ban, deletion job, no membership', () => {
  assert.equal(
    resolvePostAccessDenialReason({
      isSuperAdmin: true,
      accountStatus: 'disabled',
      accountRestriction: { action: 'system_ban', untilMs: null },
      nowMs: 1000,
      communityDeletionJobExists: true,
      communityRestrictionExists: true,
      isCommunityMember: false,
    }),
    null
  )
})

test('a member banned from the community (communityRestrictions) cannot list voters, even with communityMembers still present', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('banned')
  await seedMembership(communityId, uid)
  await seedCommunityRestriction(communityId, uid)
  await seedStatus(statusId, communityId)

  const service = buildService()
  await assert.rejects(
    service(uid, { statusId, direction: 'positive', cursor: null, limit: 20 }),
    (error) => error.code === 'permission-denied'
  )
})

test('a member with a disabled account cannot list voters', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('disabled')
  await seedMembership(communityId, uid)
  await seedUser(uid, { accountStatus: 'disabled' })
  await seedStatus(statusId, communityId)

  const service = buildService()
  await assert.rejects(
    service(uid, { statusId, direction: 'positive', cursor: null, limit: 20 }),
    (error) => error.code === 'permission-denied'
  )
})

test('a member with an active account restriction cannot list voters; once it expires (temporary_suspension), they can', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('suspended')
  await seedMembership(communityId, uid)
  await seedStatus(statusId, communityId)
  await seedAccountRestriction(uid, { action: 'temporary_suspension', until: Timestamp.fromMillis(Date.now() + 60000) })

  const stillSuspended = buildService()
  await assert.rejects(
    stillSuspended(uid, { statusId, direction: 'positive', cursor: null, limit: 20 }),
    (error) => error.code === 'permission-denied'
  )

  const afterExpiry = buildService({ now: () => Date.now() + 120000 })
  await assert.doesNotReject(afterExpiry(uid, { statusId, direction: 'positive', cursor: null, limit: 20 }))
})

test('a member cannot list voters while the community itself has a pending deletion job', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('member')
  await seedMembership(communityId, uid)
  await seedCommunityDeletionJob(communityId)
  await seedStatus(statusId, communityId)

  const service = buildService()
  await assert.rejects(
    service(uid, { statusId, direction: 'positive', cursor: null, limit: 20 }),
    (error) => error.code === 'permission-denied'
  )
})

test('a superadmin can list voters even when banned from the community / account restricted (full bypass)', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('admin')
  await seedUser(uid, { role: 'superadmin', accountStatus: 'disabled' })
  await seedCommunityRestriction(communityId, uid)
  await seedAccountRestriction(uid, { action: 'system_ban', until: null })
  await seedStatus(statusId, communityId)
  await seedUser('voterA', { username: 'voter_a' })
  await seedVote(statusId, 'voterA', 1, 1000)

  const service = buildService()
  const result = await service(uid, { statusId, direction: 'positive', cursor: null, limit: 20 })
  assert.deepEqual(result.voters, [{ userId: 'voterA', username: 'voter_a' }])
})

test('internal economyVotes fields (charged, rewardState, timestamps) and unrelated user fields are never returned', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('caller')
  await seedMembership(communityId, uid)
  await seedStatus(statusId, communityId)
  await seedUser('voterA', { username: 'voter_a', role: 'user', bio: 'segredo pessoal' })
  await seedVote(statusId, 'voterA', 1, 1000)

  const service = buildService()
  const result = await service(uid, { statusId, direction: 'positive', cursor: null, limit: 20 })
  const voter = result.voters[0]
  assert.deepEqual(Object.keys(voter).sort(), ['userId', 'username'])
  assert.equal('charged' in voter, false)
  assert.equal('rewardState' in voter, false)
  assert.equal('bio' in voter, false)
  assert.equal('role' in voter, false)
})

test('pagination: a full page returns nextCursor, and the next call continues right after it without repeats or gaps', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('caller')
  await seedMembership(communityId, uid)
  await seedStatus(statusId, communityId)
  const voterIds = Array.from({ length: 5 }, (_, index) => `voter${index}`)
  await Promise.all(voterIds.map((voterId) => seedUser(voterId, { username: voterId })))
  await Promise.all(voterIds.map((voterId, index) => seedVote(statusId, voterId, 1, 1000 + index)))

  const service = buildService()
  const firstPage = await service(uid, { statusId, direction: 'positive', cursor: null, limit: 2 })
  assert.deepEqual(firstPage.voters.map((v) => v.userId), ['voter0', 'voter1'])
  assert.ok(firstPage.nextCursor)

  const secondPage = await service(uid, {
    statusId,
    direction: 'positive',
    cursor: firstPage.nextCursor,
    limit: 2,
  })
  assert.deepEqual(secondPage.voters.map((v) => v.userId), ['voter2', 'voter3'])
  assert.ok(secondPage.nextCursor)

  const thirdPage = await service(uid, {
    statusId,
    direction: 'positive',
    cursor: secondPage.nextCursor,
    limit: 2,
  })
  assert.deepEqual(thirdPage.voters.map((v) => v.userId), ['voter4'])
  assert.equal(thirdPage.nextCursor, null)
})

test('pagination is deterministic even when two votes share the exact same firstChargedAt (documentId tie-break, no duplication or omission)', async () => {
  const communityId = id('c')
  const statusId = id('s')
  const uid = id('caller')
  await seedMembership(communityId, uid)
  await seedStatus(statusId, communityId)
  // Mesmo timestamp para os 3 -- só a ordem alfabética do documentId (voterId) deve
  // desempatar, nunca uma ordem instável/dependente da inserção.
  const voterIds = ['voterA', 'voterB', 'voterC']
  await Promise.all(voterIds.map((voterId) => seedUser(voterId, { username: voterId })))
  await Promise.all(voterIds.map((voterId) => seedVote(statusId, voterId, 1, 5000)))

  const service = buildService()
  const firstPage = await service(uid, { statusId, direction: 'positive', cursor: null, limit: 2 })
  assert.deepEqual(firstPage.voters.map((v) => v.userId), ['voterA', 'voterB'])
  const secondPage = await service(uid, {
    statusId,
    direction: 'positive',
    cursor: firstPage.nextCursor,
    limit: 2,
  })
  assert.deepEqual(secondPage.voters.map((v) => v.userId), ['voterC'])
  assert.equal(secondPage.nextCursor, null)
  // nenhum votante duplicado nem omitido entre as duas páginas.
  const allSeen = [...firstPage.voters, ...secondPage.voters].map((v) => v.userId).sort()
  assert.deepEqual(allSeen, voterIds.slice().sort())
})

test('validates statusId and direction before touching Firestore', async () => {
  const service = buildService()
  await assert.rejects(
    service('u1', { statusId: '', direction: 'positive', cursor: null, limit: 20 }),
    (error) => error.code === 'invalid-argument'
  )
  await assert.rejects(
    service('u1', { statusId: 'abc', direction: 'sideways', cursor: null, limit: 20 }),
    (error) => error.code === 'invalid-argument'
  )
})

test('a non-existent status is not-found, never leaks whether votes exist', async () => {
  const service = buildService()
  await assert.rejects(
    service('u1', { statusId: 'never-existed', direction: 'positive', cursor: null, limit: 20 }),
    (error) => error.code === 'not-found'
  )
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createWalletService } from './wallet-service.js'
import { createLedgerService } from './ledger-service.js'
import { createPrivilegeService } from './privilege-service.js'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
// Projeto próprio, mesmo raciocínio de cash-purchase-service.test.js/
// reward-settlement-service.test.js: evita contaminação cruzada com outros arquivos de
// teste rodando em paralelo contra o mesmo projeto do emulador.
initializeApp({ projectId: 'demo-treinos-privilege-test' })
const db = getFirestore()

function FakeHttpsError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

async function assertWritableAccount(tx, testUid) {
  if ((await tx.get(db.doc(`deletionJobs/account_${testUid}`))).exists) {
    throw new FakeHttpsError('failed-precondition', 'A conta está em exclusão.')
  }
}

let counter = 0
function uid() {
  return `u-${Date.now()}-${counter++}`
}
function requestId() {
  return `req-${Date.now()}-${counter++}`
}

function buildService({ now } = {}) {
  const wallet = createWalletService({ db, FieldValue })
  const ledger = createLedgerService({ db, FieldValue })
  return createPrivilegeService({
    db,
    FieldValue,
    wallet,
    ledger,
    assertWritableAccount,
    HttpsError: FakeHttpsError,
    ...(now ? { now } : {}),
  })
}

const NOW_MS = Date.parse('2026-06-01T12:00:00-03:00')
const OLD_ENOUGH_MS = NOW_MS - 30 * 86400000

const PRIVILEGE_CONFIG = {
  minimumLifetimeCoins: 200,
  minimumAccountAgeDays: 7,
  requireEmailVerified: true,
  cashCost: 50,
}

async function seedConfig(overrides = {}) {
  await db.doc('economyConfig/current').set({
    version: 1,
    privileges: { createCommunity: { ...PRIVILEGE_CONFIG, ...overrides } },
  })
}

async function seedEligibleUser({ createdAtMs = OLD_ENOUGH_MS, cashBalance = 100, lifetimeCoinsEarned = 500 } = {}) {
  const userId = uid()
  await db.doc(`users/${userId}`).set({ role: 'user', accountStatus: 'active', createdAt: Timestamp.fromMillis(createdAtMs) })
  await db.doc(`users/${userId}/wallet/current`).set({ coinBalance: 0, lifetimeCoinsEarned, cashBalance })
  return userId
}

async function getWallet(userId) {
  const snapshot = await db.doc(`users/${userId}/wallet/current`).get()
  return snapshot.exists ? snapshot.data() : { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }
}
async function getCommunity(communityId) {
  const snapshot = await db.doc(`communities/${communityId}`).get()
  return snapshot.exists ? snapshot.data() : null
}
async function getMembership(communityId, userId) {
  const snapshot = await db.doc(`communityMembers/${communityId}_${userId}`).get()
  return snapshot.exists ? snapshot.data() : null
}
async function countLedgerEntries(userId) {
  const snapshot = await db.collection(`users/${userId}/economyTransactions`).get()
  return snapshot.size
}

const VALID_INPUT = { name: 'Corrida de Rua', description: 'Para quem corre', iconName: 'flame' }

test('usuário elegível cria comunidade: debita EvoCash, grava ledger, vira owner atomicamente', async () => {
  await seedConfig()
  const buyer = await seedEligibleUser()
  const service = buildService({ now: () => NOW_MS })

  const result = await service.createCommunityWithCash(buyer, {
    ...VALID_INPUT,
    requestId: requestId(),
    emailVerified: true,
  })
  assert.equal(result.alreadyExisted, false)

  const community = await getCommunity(result.communityId)
  assert.equal(community.ownerId, buyer)
  assert.equal(community.createdBy, buyer)
  assert.equal(community.postAccess, 'everyone', 'nunca admins -- o criador não é admin global')
  assert.equal(community.isActive, true)
  assert.equal(community.memberCount, 0, 'bumpMemberCount é assíncrono via trigger, não desta transação')

  const membership = await getMembership(result.communityId, buyer)
  assert.equal(membership.role, 'owner')
  assert.equal(membership.userId, buyer)

  const wallet = await getWallet(buyer)
  assert.equal(wallet.cashBalance, 100 - PRIVILEGE_CONFIG.cashCost)
  assert.equal(await countLedgerEntries(buyer), 1)
})

test('regra fundamental: se qualquer requisito falha, EvoCash nunca é perdido (saldo idêntico antes/depois)', async () => {
  await seedConfig()
  const service = buildService({ now: () => NOW_MS })

  const cases = [
    {
      label: 'conta desativada',
      setup: () => seedEligibleUser().then(async (id) => {
        await db.doc(`users/${id}`).update({ accountStatus: 'disabled' })
        return id
      }),
    },
    {
      label: 'suspensão ativa',
      setup: async () => {
        const id = await seedEligibleUser()
        await db.doc(`accountRestrictions/${id}`).set({ action: 'temporary_suspension', until: Timestamp.fromMillis(NOW_MS + 60000) })
        return id
      },
    },
    {
      label: 'conta muito nova',
      setup: () => seedEligibleUser({ createdAtMs: NOW_MS - 86400000 }),
    },
    {
      label: 'email não verificado',
      setup: () => seedEligibleUser(),
      emailVerified: false,
    },
    {
      label: 'reputação insuficiente',
      setup: () => seedEligibleUser({ lifetimeCoinsEarned: 199 }),
    },
    {
      label: 'EvoCash insuficiente',
      setup: () => seedEligibleUser({ cashBalance: 49 }),
    },
  ]

  for (const testCase of cases) {
    const testUid = await testCase.setup()
    const before = await getWallet(testUid)
    await assert.rejects(
      () =>
        service.createCommunityWithCash(testUid, {
          ...VALID_INPUT,
          requestId: requestId(),
          emailVerified: testCase.emailVerified ?? true,
        }),
      (error) => error.code === 'failed-precondition',
      testCase.label
    )
    const after = await getWallet(testUid)
    assert.deepEqual(after, before, `${testCase.label}: saldo deveria permanecer intacto`)
    assert.equal(await countLedgerEntries(testUid), 0, `${testCase.label}: nenhum lançamento deveria existir`)
  }
})

test('suspensão temporária expirada não bloqueia', async () => {
  await seedConfig()
  const buyer = await seedEligibleUser()
  await db.doc(`accountRestrictions/${buyer}`).set({ action: 'temporary_suspension', until: Timestamp.fromMillis(NOW_MS - 1000) })
  const service = buildService({ now: () => NOW_MS })
  const result = await service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: requestId(), emailVerified: true })
  assert.equal(result.alreadyExisted, false)
})

test('system_ban bloqueia mesmo sem prazo (until null nunca expira)', async () => {
  await seedConfig()
  const buyer = await seedEligibleUser()
  await db.doc(`accountRestrictions/${buyer}`).set({ action: 'system_ban', until: null })
  const service = buildService({ now: () => NOW_MS })
  await assert.rejects(
    () => service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: requestId(), emailVerified: true }),
    (error) => error.code === 'failed-precondition'
  )
})

test('config ausente bloqueia (fail-closed), sem debitar nada', async () => {
  await db.doc('economyConfig/current').delete()
  const buyer = await seedEligibleUser()
  const service = buildService({ now: () => NOW_MS })
  await assert.rejects(
    () => service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: requestId(), emailVerified: true }),
    (error) => error.code === 'failed-precondition'
  )
  assert.equal((await getWallet(buyer)).cashBalance, 100)
})

test('config com campo corrompido bloqueia (fail-closed)', async () => {
  await db.doc('economyConfig/current').set({
    version: 1,
    privileges: { createCommunity: { ...PRIVILEGE_CONFIG, cashCost: -5 } },
  })
  const buyer = await seedEligibleUser()
  const service = buildService({ now: () => NOW_MS })
  await assert.rejects(
    () => service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: requestId(), emailVerified: true }),
    (error) => error.code === 'failed-precondition'
  )
})

test('conta em exclusão bloqueia via assertWritableAccount', async () => {
  await seedConfig()
  const buyer = await seedEligibleUser()
  await db.doc(`deletionJobs/account_${buyer}`).set({ state: 'pending' })
  const service = buildService({ now: () => NOW_MS })
  await assert.rejects(
    () => service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: requestId(), emailVerified: true }),
    (error) => error.code === 'failed-precondition'
  )
})

test('cliente não define cashCost/minimumLifetimeCoins -- só name/description/iconName/requestId são lidos', async () => {
  await seedConfig()
  const buyer = await seedEligibleUser({ cashBalance: 100 })
  const service = buildService({ now: () => NOW_MS })
  const result = await service.createCommunityWithCash(buyer, {
    ...VALID_INPUT,
    requestId: requestId(),
    emailVerified: true,
    cashCost: 999999,
    minimumLifetimeCoins: 0,
  })
  const wallet = await getWallet(buyer)
  assert.equal(wallet.cashBalance, 100 - PRIVILEGE_CONFIG.cashCost, 'cashCost do cliente é ignorado')
  assert.ok(result.communityId)
})

test('mesmo requestId + mesmo payload -> replay: mesmo communityId, sem segundo débito', async () => {
  await seedConfig()
  const buyer = await seedEligibleUser()
  const service = buildService({ now: () => NOW_MS })
  const rid = requestId()
  const first = await service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: rid, emailVerified: true })
  const second = await service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: rid, emailVerified: true })

  assert.equal(second.communityId, first.communityId)
  assert.equal(second.alreadyExisted, true)
  const wallet = await getWallet(buyer)
  assert.equal(wallet.cashBalance, 100 - PRIVILEGE_CONFIG.cashCost, 'não debitou duas vezes')
  assert.equal(await countLedgerEntries(buyer), 1)
})

test('mesmo requestId + payload diferente -> conflito, nunca devolve silenciosamente a comunidade antiga', async () => {
  await seedConfig()
  const buyer = await seedEligibleUser()
  const service = buildService({ now: () => NOW_MS })
  const rid = requestId()
  await service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: rid, emailVerified: true })
  await assert.rejects(
    () => service.createCommunityWithCash(buyer, { ...VALID_INPUT, name: 'Nome diferente', requestId: rid, emailVerified: true }),
    (error) => error.code === 'already-exists'
  )
})

test('requestId diferente após esgotar o saldo -- segunda tentativa revalida do zero e falha', async () => {
  await seedConfig()
  const buyer = await seedEligibleUser({ cashBalance: 50 }) // exatamente o suficiente para 1
  const service = buildService({ now: () => NOW_MS })
  await service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: requestId(), emailVerified: true })
  assert.equal((await getWallet(buyer)).cashBalance, 0)
  await assert.rejects(
    () => service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: requestId(), emailVerified: true }),
    (error) => error.code === 'failed-precondition'
  )
})

test('concorrência: duas chamadas simultâneas com o mesmo requestId nunca debitam duas vezes', async () => {
  await seedConfig()
  const buyer = await seedEligibleUser()
  const service = buildService({ now: () => NOW_MS })
  const rid = requestId()
  const results = await Promise.allSettled([
    service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: rid, emailVerified: true }),
    service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: rid, emailVerified: true }),
  ])
  const communityIds = new Set(results.filter((r) => r.status === 'fulfilled').map((r) => r.value.communityId))
  assert.equal(communityIds.size, 1, 'as duas, se bem-sucedidas, apontam para a MESMA comunidade')
  assert.equal(await countLedgerEntries(buyer), 1)
  assert.equal((await getWallet(buyer)).cashBalance, 100 - PRIVILEGE_CONFIG.cashCost)
})

test('regra fundamental: sempre que a comunidade existe, existe exatamente 1 lançamento de débito no ledger', async () => {
  await seedConfig()
  const buyer = await seedEligibleUser()
  const service = buildService({ now: () => NOW_MS })
  const result = await service.createCommunityWithCash(buyer, { ...VALID_INPUT, requestId: requestId(), emailVerified: true })
  assert.ok(await getCommunity(result.communityId))
  const ledgerSnapshot = await db.collection(`users/${buyer}/economyTransactions`).get()
  const createEntries = ledgerSnapshot.docs.filter((d) => d.data().reason === 'create_community')
  assert.equal(createEntries.length, 1)
  assert.equal(createEntries[0].data().referenceId, result.communityId)
  assert.equal(createEntries[0].data().direction, 'debit')
  assert.equal(createEntries[0].data().amount, PRIVILEGE_CONFIG.cashCost)
})

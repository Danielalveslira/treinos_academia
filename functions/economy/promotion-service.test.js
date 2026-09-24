import { test } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createWalletService } from './wallet-service.js'
import { createLedgerService } from './ledger-service.js'
import { createPromotionService } from './promotion-service.js'
import { createPromotionIdFromRequest } from './promotion-core.js'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
initializeApp({ projectId: 'demo-treinos-promotion-test' })
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

function buildService({ now } = {}) {
  const wallet = createWalletService({ db, FieldValue })
  const ledger = createLedgerService({ db, FieldValue })
  return createPromotionService({
    db,
    FieldValue,
    Timestamp,
    wallet,
    ledger,
    assertWritableAccount,
    HttpsError: FakeHttpsError,
    ...(now ? { now } : {}),
  })
}

let counter = 0
function uid() {
  return `u-${Date.now()}-${counter++}`
}
function requestId() {
  return `req-${Date.now()}-${counter++}`
}

const PACKAGES = {
  post_boost_3d: { targetType: 'post', cashAmount: 25, durationDays: 3, label: 'Destaque 3 dias', active: true },
  post_boost_7d: { targetType: 'post', cashAmount: 50, durationDays: 7, label: 'Destaque 7 dias', active: true },
  community_boost_7d: {
    targetType: 'community',
    cashAmount: 100,
    durationDays: 7,
    label: 'Comunidade em destaque 7 dias',
    active: true,
  },
  community_boost_30d: {
    targetType: 'community',
    cashAmount: 300,
    durationDays: 30,
    label: 'Comunidade em destaque 30 dias',
    active: true,
  },
}

async function seedConfig(overrides = {}) {
  await db.doc('economyConfig/current').set({ version: 9, promotionPackages: PACKAGES, ...overrides })
}
async function seedStatus(statusId, { communityId, authorId, ...extra } = {}) {
  await db.doc(`statuses/${statusId}`).set({ communityId, authorId, type: 'text', text: 'oi', ...extra })
}
async function seedCommunity(communityId, { ownerId, isActive = true, ...extra } = {}) {
  await db.doc(`communities/${communityId}`).set({ ownerId, isActive, name: 'c', ...extra })
}
// createPromotion agora exige membership atual do AUTOR na comunidade (revisão final da
// Fase 6: um autor que saiu ou foi banido não pode promover um post antigo só porque
// authorId ainda bate) -- todo teste que espera sucesso (ou um bloqueio que não seja
// not_a_member) precisa seedar isto explicitamente.
async function seedMembership(communityId, memberUid) {
  await db.doc(`communityMembers/${communityId}_${memberUid}`).set({ uid: memberUid, communityId, joinedAt: Timestamp.now() })
}
async function seedCommunityRestriction(communityId, memberUid, extra = {}) {
  await db.doc(`communityRestrictions/${communityId}_${memberUid}`).set({ action: 'ban', ...extra })
}
async function fundWallet(testUid, cashBalance) {
  await db.doc(`users/${testUid}/wallet/current`).set({ coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance })
}
async function getWallet(testUid) {
  const snapshot = await db.doc(`users/${testUid}/wallet/current`).get()
  return snapshot.exists ? snapshot.data() : { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }
}
async function getPromotion(promotionId) {
  const snapshot = await db.doc(`promotions/${promotionId}`).get()
  return snapshot.exists ? snapshot.data() : null
}
async function getStatus(statusId) {
  return (await db.doc(`statuses/${statusId}`).get()).data()
}
async function getCommunity(communityId) {
  return (await db.doc(`communities/${communityId}`).get()).data()
}
async function countLedgerEntries(testUid) {
  const snapshot = await db.collection(`users/${testUid}/economyTransactions`).get()
  return snapshot.size
}

// ---- caminho feliz -----------------------------------------------------------------

test('promover um post: debita EvoCash, cria promotions/{id}, marca o status como promovido e grava activePromotionId, grava 1 lançamento no ledger', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()

  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })

  assert.equal(result.status, 'active')
  assert.equal(result.cashAmount, 25)
  assert.equal(result.durationDays, 3)

  const promotion = await getPromotion(result.promotionId)
  assert.equal(promotion.ownerId, authorId)
  assert.equal(promotion.targetType, 'post')
  assert.equal(promotion.targetId, statusId)
  assert.equal(promotion.communityId, communityId)
  assert.equal(promotion.status, 'active')
  assert.equal(promotion.clickCount, 0)
  assert.equal(promotion.expiresAt.toMillis() - promotion.startedAt.toMillis(), 3 * 86400000)

  const status = await getStatus(statusId)
  assert.equal(status.promoted, true)
  assert.equal(status.promotedUntil.toMillis(), promotion.expiresAt.toMillis())
  assert.equal(status.activePromotionId, result.promotionId)

  const wallet = await getWallet(authorId)
  assert.equal(wallet.cashBalance, 75)
  assert.equal(await countLedgerEntries(authorId), 1)
})

test('promover uma comunidade: debita EvoCash, cria promotions/{id}, marca a comunidade como promovida e grava activePromotionId', async () => {
  await seedConfig()
  const ownerId = uid()
  const communityId = uid()
  await seedCommunity(communityId, { ownerId })
  await seedMembership(communityId, ownerId)
  await fundWallet(ownerId, 500)
  const service = buildService()

  const result = await service.createPromotion(ownerId, {
    targetType: 'community',
    targetId: communityId,
    packageId: 'community_boost_30d',
    requestId: requestId(),
  })

  assert.equal(result.durationDays, 30)
  const promotion = await getPromotion(result.promotionId)
  assert.equal(promotion.communityId, communityId)
  const community = await getCommunity(communityId)
  assert.equal(community.promoted, true)
  assert.equal(community.promotedUntil.toMillis(), promotion.expiresAt.toMillis())
  assert.equal(community.activePromotionId, result.promotionId)
  assert.equal((await getWallet(ownerId)).cashBalance, 200)
})

// ---- regra fundamental #1: sem promoção criada, EvoCash nunca é perdido -------------

test('REGRA FUNDAMENTAL: saldo insuficiente bloqueia -- nenhuma escrita acontece (sem promoção, sem débito, sem ledger)', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 10) // pack custa 25
  const service = buildService()

  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: statusId,
      packageId: 'post_boost_3d',
      requestId: requestId(),
    }),
    (error) => error.code === 'failed-precondition'
  )

  assert.equal((await getWallet(authorId)).cashBalance, 10, 'saldo intacto')
  assert.equal(await countLedgerEntries(authorId), 0)
  const status = await getStatus(statusId)
  assert.equal(status.promoted ?? false, false)
})

test('não-dono não consegue promover o post/comunidade de outra pessoa -- nada é escrito', async () => {
  await seedConfig()
  const authorId = uid()
  const outsider = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await fundWallet(outsider, 100)
  const service = buildService()

  await assert.rejects(
    service.createPromotion(outsider, {
      targetType: 'post',
      targetId: statusId,
      packageId: 'post_boost_3d',
      requestId: requestId(),
    }),
    (error) => error.code === 'permission-denied'
  )
  assert.equal((await getWallet(outsider)).cashBalance, 100)

  const communityOwner = uid()
  const community2 = uid()
  await seedCommunity(community2, { ownerId: communityOwner })
  await fundWallet(outsider, 500)
  await assert.rejects(
    service.createPromotion(outsider, {
      targetType: 'community',
      targetId: community2,
      packageId: 'community_boost_7d',
      requestId: requestId(),
    }),
    (error) => error.code === 'permission-denied'
  )
})

test('autor que saiu da comunidade (nunca teve/perdeu membership) não pode promover um post antigo, mesmo com authorId batendo', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  // deliberadamente NÃO seeda communityMembers/{communityId}_{authorId}
  await fundWallet(authorId, 100)
  const service = buildService()
  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: statusId,
      packageId: 'post_boost_3d',
      requestId: requestId(),
    }),
    (error) => error.code === 'permission-denied'
  )
  assert.equal((await getWallet(authorId)).cashBalance, 100, 'nada debitado')
  assert.equal(await countLedgerEntries(authorId), 0)
})

test('autor banido da comunidade (communityRestrictions) não pode promover, mesmo sendo membro e com authorId batendo', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await seedCommunityRestriction(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: statusId,
      packageId: 'post_boost_3d',
      requestId: requestId(),
    }),
    (error) => error.code === 'permission-denied'
  )
  assert.equal((await getWallet(authorId)).cashBalance, 100, 'nada debitado')
})

test('alvo inexistente falha com not-found, sem cobrar nada', async () => {
  await seedConfig()
  const authorId = uid()
  await fundWallet(authorId, 100)
  const service = buildService()
  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: 'never-existed',
      packageId: 'post_boost_3d',
      requestId: requestId(),
    }),
    (error) => error.code === 'not-found'
  )
})

test('pacote inválido/inexistente bloqueia', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: statusId,
      packageId: 'nao_existe',
      requestId: requestId(),
    }),
    (error) => error.code === 'failed-precondition'
  )
})

test('pacote de comunidade não pode ser usado para promover um post (targetType não bate)', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 500)
  const service = buildService()
  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: statusId,
      packageId: 'community_boost_7d',
      requestId: requestId(),
    }),
    (error) => error.code === 'failed-precondition'
  )
})

test('economyConfig ausente bloqueia (fail-closed, nunca cai num default embutido)', async () => {
  // economyConfig/current é um documento único compartilhado entre os testes deste
  // arquivo -- apaga explicitamente pra simular "nunca configurado", já que outros
  // testes (que rodam antes) já o preenchem via seedConfig().
  await db.doc('economyConfig/current').delete()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: statusId,
      packageId: 'post_boost_3d',
      requestId: requestId(),
    }),
    (error) => error.code === 'failed-precondition'
  )
})

test('comunidade com deletionJob pendente bloqueia promoção (do post ou da própria comunidade)', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: authorId })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await db.doc(`deletionJobs/community_${communityId}`).set({ state: 'pending' })
  await fundWallet(authorId, 500)
  const service = buildService()

  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: statusId,
      packageId: 'post_boost_3d',
      requestId: requestId(),
    }),
    (error) => error.code === 'failed-precondition'
  )
  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'community',
      targetId: communityId,
      packageId: 'community_boost_7d',
      requestId: requestId(),
    }),
    (error) => error.code === 'failed-precondition'
  )
})

test('comunidade inativa (isActive:false) bloqueia promoção', async () => {
  await seedConfig()
  const ownerId = uid()
  const communityId = uid()
  await seedCommunity(communityId, { ownerId, isActive: false })
  await seedMembership(communityId, ownerId)
  await fundWallet(ownerId, 500)
  const service = buildService()
  await assert.rejects(
    service.createPromotion(ownerId, {
      targetType: 'community',
      targetId: communityId,
      packageId: 'community_boost_7d',
      requestId: requestId(),
    }),
    (error) => error.code === 'failed-precondition'
  )
})

test('conta restrita (banimento permanente) não consegue promover', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await db.doc(`accountRestrictions/${authorId}`).set({ action: 'system_ban' })
  await fundWallet(authorId, 100)
  const service = buildService()
  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: statusId,
      packageId: 'post_boost_3d',
      requestId: requestId(),
    }),
    (error) => error.code === 'permission-denied'
  )
})

test('conta em exclusão (deletionJobs/account_uid) não consegue promover', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await db.doc(`deletionJobs/account_${authorId}`).set({ state: 'pending' })
  await fundWallet(authorId, 100)
  const service = buildService()
  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: statusId,
      packageId: 'post_boost_3d',
      requestId: requestId(),
    }),
    (error) => error.code === 'failed-precondition'
  )
})

// ---- regra fundamental #2: se a promoção existe, o débito existe exatamente uma vez -

test('REGRA FUNDAMENTAL: retry com o mesmo requestId devolve a MESMA promoção, sem debitar de novo', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  const reqId = requestId()

  const first = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: reqId,
  })
  const second = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: reqId,
  })

  assert.equal(first.promotionId, second.promotionId)
  assert.equal((await getWallet(authorId)).cashBalance, 75, 'debitado só uma vez')
  assert.equal(await countLedgerEntries(authorId), 1)
})

test('reenviar o mesmo requestId com um alvo/pacote diferente é conflito, nunca devolve uma promoção diferente da pedida', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  const statusId2 = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedStatus(statusId2, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  const reqId = requestId()

  await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: reqId,
  })
  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: statusId2,
      packageId: 'post_boost_3d',
      requestId: reqId,
    }),
    (error) => error.code === 'already-exists'
  )
  assert.equal(await countLedgerEntries(authorId), 1)
})

test('já existe uma promoção ativa para este alvo -- bloqueia uma segunda compra concorrente (sem stacking na V1)', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 200)
  const service = buildService()

  await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })
  await assert.rejects(
    service.createPromotion(authorId, {
      targetType: 'post',
      targetId: statusId,
      packageId: 'post_boost_7d',
      requestId: requestId(),
    }),
    (error) => error.code === 'failed-precondition'
  )
  assert.equal((await getWallet(authorId)).cashBalance, 175, 'só a primeira compra debitou')
})

test('uma promoção já expirada não bloqueia uma nova compra para o mesmo alvo', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 200)
  const past = () => 1000
  const serviceInThePast = buildService({ now: past })
  await serviceInThePast.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })

  const future = () => 1000 + 4 * 86400000 // depois dos 3 dias do pacote
  const serviceInTheFuture = buildService({ now: future })
  const result = await serviceInTheFuture.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_7d',
    requestId: requestId(),
  })
  assert.equal(result.status, 'active')
  assert.equal((await getWallet(authorId)).cashBalance, 125)
})

// ---- cálculo de startedAt/expiresAt --------------------------------------------------

test('startedAt/expiresAt vêm do MESMO instante -- a diferença é exatamente durationDays em ms', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const fixedNow = 1_700_000_000_000
  const service = buildService({ now: () => fixedNow })

  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_7d',
    requestId: requestId(),
  })
  const promotion = await getPromotion(result.promotionId)
  assert.equal(promotion.startedAt.toMillis(), fixedNow)
  assert.equal(promotion.expiresAt.toMillis(), fixedNow + 7 * 86400000)
})

// ---- cancelamento ---------------------------------------------------------------------

test('dono cancela sua própria promoção sem precisar de motivo -- sem reembolso, flag e activePromotionId do alvo são limpos', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })
  const balanceAfterPurchase = (await getWallet(authorId)).cashBalance

  await service.cancelPromotion(authorId, { promotionId: result.promotionId })

  const promotion = await getPromotion(result.promotionId)
  assert.equal(promotion.status, 'cancelled')
  assert.equal(promotion.cancelledBy, authorId)
  const status = await getStatus(statusId)
  assert.equal(status.promoted, false)
  assert.equal(status.promotedUntil, null)
  assert.equal(status.activePromotionId, null)
  assert.equal((await getWallet(authorId)).cashBalance, balanceAfterPurchase, 'sem reembolso')
})

test('superadmin cancelando exige motivo (>=5 caracteres); sem motivo é rejeitado', async () => {
  await seedConfig()
  const authorId = uid()
  const adminId = uid()
  await db.doc(`users/${adminId}`).set({ role: 'superadmin' })
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })

  await assert.rejects(
    service.cancelPromotion(adminId, { promotionId: result.promotionId }),
    (error) => error.code === 'invalid-argument'
  )
  await assert.rejects(
    service.cancelPromotion(adminId, { promotionId: result.promotionId, reason: 'oi' }),
    (error) => error.code === 'invalid-argument'
  )
  await service.cancelPromotion(adminId, { promotionId: result.promotionId, reason: 'conteúdo inadequado' })
  const promotion = await getPromotion(result.promotionId)
  assert.equal(promotion.status, 'cancelled')
  assert.equal(promotion.cancelledBy, adminId)
  assert.equal(promotion.cancelReason, 'conteúdo inadequado')
})

test('terceiro (nem dono, nem superadmin) não pode cancelar', async () => {
  await seedConfig()
  const authorId = uid()
  const outsider = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })
  await assert.rejects(
    service.cancelPromotion(outsider, { promotionId: result.promotionId }),
    (error) => error.code === 'permission-denied'
  )
})

test('cancelar uma promoção que já não está ativa falha', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })
  await service.cancelPromotion(authorId, { promotionId: result.promotionId })
  await assert.rejects(
    service.cancelPromotion(authorId, { promotionId: result.promotionId }),
    (error) => error.code === 'failed-precondition'
  )
})

// ---- métricas: recordPromotionEvent --------------------------------------------------

test('recordPromotionEvent(click) incrementa clickCount; impression ainda não é suportado na V1', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })

  await service.recordPromotionEvent(uid(), {
    targetType: 'post',
    targetId: statusId,
    promotionId: result.promotionId,
    type: 'click',
  })
  await service.recordPromotionEvent(uid(), {
    targetType: 'post',
    targetId: statusId,
    promotionId: result.promotionId,
    type: 'click',
  })
  assert.equal((await getPromotion(result.promotionId)).clickCount, 2)

  await assert.rejects(
    service.recordPromotionEvent(uid(), {
      targetType: 'post',
      targetId: statusId,
      promotionId: result.promotionId,
      type: 'impression',
    }),
    (error) => error.code === 'invalid-argument'
  )
})

// Auditoria de backend: recordPromotionEvent não tinha nenhum limite de frequência --
// nada impedia chamar em loop apertado contra a mesma promoção e gerar escrita
// ilimitada. Uma janela curta por (uid, promoção) fecha isso sem exigir troca de
// usuário nem afetar o clique real de sempre (nunca se repete em menos de 10s no
// MESMO card).
test('recordPromotionEvent within the throttle window from the same user is a silent no-op; a later click still counts', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  const clicker = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  let clock = Date.now()
  const service = buildService({ now: () => clock })
  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })

  const eventArgs = {
    targetType: 'post',
    targetId: statusId,
    promotionId: result.promotionId,
    type: 'click',
  }
  const first = await service.recordPromotionEvent(clicker, eventArgs)
  assert.equal(first.recorded, true)
  const second = await service.recordPromotionEvent(clicker, eventArgs)
  assert.equal(second.recorded, false, 'a rapid repeat click from the same user must be a silent no-op')
  assert.equal((await getPromotion(result.promotionId)).clickCount, 1)

  // Fechamento da auditoria: o próprio registro de throttle precisa carregar um
  // expireAt no futuro -- é o que purgeExpiredPromotionEventLimits (index.js) usa
  // para limpar estes documentos mais tarde, já que a chave composta (uid_promotionId)
  // não entra no lote final de deletion-service.js.
  const throttleDoc = await db.doc(`promotionEventLimits/${clicker}_${result.promotionId}`).get()
  assert.ok(throttleDoc.exists)
  assert.ok(throttleDoc.data().expireAt.toMillis() > clock, 'expireAt must be set in the future')

  // Passado o suficiente da janela, o próximo clique do MESMO usuário volta a contar.
  clock += 11 * 1000
  const third = await service.recordPromotionEvent(clicker, eventArgs)
  assert.equal(third.recorded, true)
  assert.equal((await getPromotion(result.promotionId)).clickCount, 2)
})

test('recordPromotionEvent numa promoção inexistente falha com not-found', async () => {
  const service = buildService()
  await assert.rejects(
    service.recordPromotionEvent(uid(), {
      targetType: 'post',
      targetId: 'never-existed-target',
      promotionId: 'never-existed',
      type: 'click',
    }),
    (error) => error.code === 'not-found'
  )
})

test('recordPromotionEvent rejeita quando targetType/targetId não correspondem à promoção (nunca confia cegamente no ID vindo do cliente)', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  const otherStatusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedStatus(otherStatusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })

  await assert.rejects(
    service.recordPromotionEvent(uid(), {
      targetType: 'post',
      targetId: otherStatusId,
      promotionId: result.promotionId,
      type: 'click',
    }),
    (error) => error.code === 'failed-precondition'
  )
  await assert.rejects(
    service.recordPromotionEvent(uid(), {
      targetType: 'community',
      targetId: statusId,
      promotionId: result.promotionId,
      type: 'click',
    }),
    (error) => error.code === 'failed-precondition'
  )
  assert.equal((await getPromotion(result.promotionId)).clickCount, 0, 'nenhum clique indevido foi contado')
})

test('recordPromotionEvent rejeita uma promoção já expirada, mesmo que status ainda diga "active" (nunca confia em status isolado)', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const fixedNow = 1_000_000
  const service = buildService({ now: () => fixedNow })
  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })
  // ninguém rodou cancelPromotion/markTargetRemoved -- o documento continua com
  // status:'active' pra sempre (não existe scheduler); só expiresAt no passado revela
  // que já encerrou.
  const serviceAfterExpiry = buildService({ now: () => fixedNow + 4 * 86400000 })
  await assert.rejects(
    serviceAfterExpiry.recordPromotionEvent(uid(), {
      targetType: 'post',
      targetId: statusId,
      promotionId: result.promotionId,
      type: 'click',
    }),
    (error) => error.code === 'failed-precondition'
  )
  assert.equal((await getPromotion(result.promotionId)).clickCount, 0)
})

// ---- markTargetRemoved (gatilhos de exclusão) ----------------------------------------

test('markTargetRemoved fecha uma promoção ativa como target_removed, sem apagar o documento (histórico econômico preservado)', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })

  await service.markTargetRemoved('post', statusId)
  const promotion = await getPromotion(result.promotionId)
  assert.ok(promotion, 'o documento continua existindo -- nunca é apagado')
  assert.equal(promotion.status, 'target_removed')
  assert.equal(promotion.cancelReason, 'Alvo removido.')
})

test('markTargetRemoved é idempotente e é um no-op quando não há promoção ativa para o alvo', async () => {
  const service = buildService()
  await assert.doesNotReject(service.markTargetRemoved('post', 'nunca-teve-promocao'))

  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: requestId(),
  })
  await service.markTargetRemoved('post', statusId)
  await assert.doesNotReject(service.markTargetRemoved('post', statusId))
  assert.equal((await getPromotion(result.promotionId)).status, 'target_removed')
})

test('createPromotionIdFromRequest usado pelo service é o mesmo previsto pela função pura (sanity check de integração)', async () => {
  await seedConfig()
  const authorId = uid()
  const communityId = uid()
  const statusId = uid()
  await seedCommunity(communityId, { ownerId: uid() })
  await seedStatus(statusId, { communityId, authorId })
  await seedMembership(communityId, authorId)
  await fundWallet(authorId, 100)
  const service = buildService()
  const reqId = requestId()
  const result = await service.createPromotion(authorId, {
    targetType: 'post',
    targetId: statusId,
    packageId: 'post_boost_3d',
    requestId: reqId,
  })
  assert.equal(result.promotionId, createPromotionIdFromRequest(authorId, reqId))
})

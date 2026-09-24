import { test } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createCommunityModerationService } from './community-moderation-service.js'
import { isProtectedRole } from './moderation-core.js'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
initializeApp({ projectId: 'demo-treinos-functions-test' })
const db = getFirestore()

function FakeHttpsError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

let counter = 0
function uid() {
  return `u-${Date.now()}-${counter++}`
}

function buildService() {
  return createCommunityModerationService({ db, FieldValue, HttpsError: FakeHttpsError, isProtectedRole })
}

async function seedCommunity({ ownerId }) {
  const communityId = uid()
  await db.doc(`communities/${communityId}`).set({ ownerId, createdBy: ownerId, isActive: true })
  return communityId
}

async function getRestriction(communityId, userId) {
  const snapshot = await db.doc(`communityRestrictions/${communityId}_${userId}`).get()
  return snapshot.exists ? snapshot.data() : null
}

test('owner bane e desbane um membro na própria comunidade', async () => {
  const service = buildService()
  const owner = uid()
  const target = uid()
  await db.doc(`users/${owner}`).set({ role: 'user' })
  await db.doc(`users/${target}`).set({ role: 'user' })
  const communityId = await seedCommunity({ ownerId: owner })

  const result = await service.setCommunityMemberBan(owner, {
    communityId,
    targetUserId: target,
    banned: true,
    reason: 'violou as regras da comunidade',
  })
  assert.equal(result.banned, true)
  const restriction = await getRestriction(communityId, target)
  assert.equal(restriction.bannedBy, owner)
  assert.equal(restriction.communityId, communityId)

  await service.setCommunityMemberBan(owner, { communityId, targetUserId: target, banned: false })
  assert.equal(await getRestriction(communityId, target), null)
})

test('owner NÃO bane em uma comunidade de outro owner', async () => {
  const service = buildService()
  const owner1 = uid()
  const owner2 = uid()
  const target = uid()
  await db.doc(`users/${owner1}`).set({ role: 'user' })
  await db.doc(`users/${owner2}`).set({ role: 'user' })
  await db.doc(`users/${target}`).set({ role: 'user' })
  const communityOfOwner2 = await seedCommunity({ ownerId: owner2 })

  await assert.rejects(
    () =>
      service.setCommunityMemberBan(owner1, {
        communityId: communityOfOwner2,
        targetUserId: target,
        banned: true,
        reason: 'tentativa de invasão',
      }),
    (error) => error.code === 'permission-denied'
  )
  assert.equal(await getRestriction(communityOfOwner2, target), null)
})

test('usuário comum sem nenhuma relação com a comunidade não consegue banir', async () => {
  const service = buildService()
  const stranger = uid()
  const owner = uid()
  const target = uid()
  await db.doc(`users/${stranger}`).set({ role: 'user' })
  await db.doc(`users/${owner}`).set({ role: 'user' })
  await db.doc(`users/${target}`).set({ role: 'user' })
  const communityId = await seedCommunity({ ownerId: owner })

  await assert.rejects(
    () =>
      service.setCommunityMemberBan(stranger, {
        communityId,
        targetUserId: target,
        banned: true,
        reason: 'sem nenhuma autoridade aqui',
      }),
    (error) => error.code === 'permission-denied'
  )
})

test('superadmin pode banir em QUALQUER comunidade, mesmo sem ser o owner dela', async () => {
  const service = buildService()
  const admin = uid()
  const owner = uid()
  const target = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  await db.doc(`users/${owner}`).set({ role: 'user' })
  await db.doc(`users/${target}`).set({ role: 'user' })
  const communityId = await seedCommunity({ ownerId: owner })

  await service.setCommunityMemberBan(admin, {
    communityId,
    targetUserId: target,
    banned: true,
    reason: 'ação global do superadmin',
  })
  const restriction = await getRestriction(communityId, target)
  assert.equal(restriction.bannedBy, admin)
})

test('banimento exige motivo com pelo menos 5 caracteres; desbanimento não exige motivo', async () => {
  const service = buildService()
  const owner = uid()
  const target = uid()
  await db.doc(`users/${owner}`).set({ role: 'user' })
  await db.doc(`users/${target}`).set({ role: 'user' })
  const communityId = await seedCommunity({ ownerId: owner })

  await assert.rejects(
    () => service.setCommunityMemberBan(owner, { communityId, targetUserId: target, banned: true, reason: 'oi' }),
    (error) => error.code === 'invalid-argument'
  )
  await assert.doesNotReject(() =>
    service.setCommunityMemberBan(owner, { communityId, targetUserId: target, banned: false })
  )
})

test('ninguém pode banir a si mesmo, nem o superadmin', async () => {
  const service = buildService()
  const admin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  const communityId = await seedCommunity({ ownerId: admin })
  await assert.rejects(
    () =>
      service.setCommunityMemberBan(admin, {
        communityId,
        targetUserId: admin,
        banned: true,
        reason: 'autobanimento acidental',
      }),
    (error) => error.code === 'failed-precondition'
  )
})

test('não é possível banir um administrador (papel protegido), mesmo por outro superadmin', async () => {
  const service = buildService()
  const admin = uid()
  const otherAdmin = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  await db.doc(`users/${otherAdmin}`).set({ role: 'superadmin' })
  const communityId = await seedCommunity({ ownerId: admin })
  await assert.rejects(
    () =>
      service.setCommunityMemberBan(admin, {
        communityId,
        targetUserId: otherAdmin,
        banned: true,
        reason: 'tentativa inválida',
      }),
    (error) => error.code === 'failed-precondition'
  )
})

test('o owner nunca recebe nenhuma capacidade global: a restrição gravada é sempre communityRestrictions, nunca accountRestrictions', async () => {
  const service = buildService()
  const owner = uid()
  const target = uid()
  await db.doc(`users/${owner}`).set({ role: 'user' })
  await db.doc(`users/${target}`).set({ role: 'user' })
  const communityId = await seedCommunity({ ownerId: owner })

  await service.setCommunityMemberBan(owner, {
    communityId,
    targetUserId: target,
    banned: true,
    reason: 'restrito só a esta comunidade',
  })
  const accountRestriction = await db.doc(`accountRestrictions/${target}`).get()
  assert.equal(accountRestriction.exists, false, 'jamais deveria tocar accountRestrictions (esse é sempre global)')
})

// Política registrada na auditoria da Fase 5: um community_ban aplicado pela moderação
// GLOBAL (decideSupportRequest -- o mesmo shape, com decisionId, que aquela função
// grava) é uma decisão formal (com evidência e recurso possível) e nunca pode ser
// desfeita pelo dono via este caminho leve. Simulado aqui semeando o restriction
// diretamente com decisionId, em vez de rodar decideSupportRequest inteiro.
test('owner NÃO pode remover um community_ban aplicado pela moderação global (decisionId presente)', async () => {
  const service = buildService()
  const owner = uid()
  const target = uid()
  await db.doc(`users/${owner}`).set({ role: 'user' })
  await db.doc(`users/${target}`).set({ role: 'user' })
  const communityId = await seedCommunity({ ownerId: owner })
  await db.doc(`communityRestrictions/${communityId}_${target}`).set({
    userId: target,
    communityId,
    decisionId: 'formal-decision-1',
  })

  await assert.rejects(
    () => service.setCommunityMemberBan(owner, { communityId, targetUserId: target, banned: false }),
    (error) => error.code === 'permission-denied'
  )
  assert.ok(await getRestriction(communityId, target), 'a decisão formal continua em vigor')
})

test('superadmin PODE remover um community_ban aplicado pela moderação global', async () => {
  const service = buildService()
  const admin = uid()
  const owner = uid()
  const target = uid()
  await db.doc(`users/${admin}`).set({ role: 'superadmin' })
  await db.doc(`users/${owner}`).set({ role: 'user' })
  await db.doc(`users/${target}`).set({ role: 'user' })
  const communityId = await seedCommunity({ ownerId: owner })
  await db.doc(`communityRestrictions/${communityId}_${target}`).set({
    userId: target,
    communityId,
    decisionId: 'formal-decision-2',
  })

  await service.setCommunityMemberBan(admin, { communityId, targetUserId: target, banned: false })
  assert.equal(await getRestriction(communityId, target), null)
})

// Auditoria de backend: a mesma proteção acima existia SÓ para desbanir -- o caminho
// de banir sobrescrevia (ref.set incondicional) qualquer restrição já existente,
// inclusive uma decisão formal, apagando decisionId sem checagem nenhuma. Depois
// disso, a proteção de desbanimento deixava de valer (o documento sobrescrito já não
// tinha mais decisionId), então o owner conseguiria desbanir livremente em seguida --
// um jeito indireto de contornar a mesma regra.
test('owner NÃO pode sobrescrever (rebanir) um community_ban aplicado pela moderação global', async () => {
  const service = buildService()
  const owner = uid()
  const target = uid()
  await db.doc(`users/${owner}`).set({ role: 'user' })
  await db.doc(`users/${target}`).set({ role: 'user' })
  const communityId = await seedCommunity({ ownerId: owner })
  await db.doc(`communityRestrictions/${communityId}_${target}`).set({
    userId: target,
    communityId,
    decisionId: 'formal-decision-3',
  })

  await assert.rejects(
    () =>
      service.setCommunityMemberBan(owner, {
        communityId,
        targetUserId: target,
        banned: true,
        reason: 'tentativa de sobrescrever a decisão formal',
      }),
    (error) => error.code === 'permission-denied'
  )
  assert.equal(
    (await getRestriction(communityId, target)).decisionId,
    'formal-decision-3',
    'a decisão formal precisa sobreviver intacta, não só continuar existindo'
  )
})

test('owner PODE remover um banimento que ele mesmo aplicou pelo caminho leve (sem decisionId)', async () => {
  const service = buildService()
  const owner = uid()
  const target = uid()
  await db.doc(`users/${owner}`).set({ role: 'user' })
  await db.doc(`users/${target}`).set({ role: 'user' })
  const communityId = await seedCommunity({ ownerId: owner })
  await service.setCommunityMemberBan(owner, {
    communityId,
    targetUserId: target,
    banned: true,
    reason: 'banimento do próprio dono, sem decisionId',
  })

  await service.setCommunityMemberBan(owner, { communityId, targetUserId: target, banned: false })
  assert.equal(await getRestriction(communityId, target), null)
})

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore'

// Fase 6 (promoções pagas com EvoCash) -- cobre só o que é NOVO nesta fase:
// promotions/{id} (leitura restrita a dono/superadmin, escrita sempre false -- só a
// Admin SDK via createPromotion/cancelPromotion/recordPromotionEvent) e a imutabilidade
// de promoted/promotedUntil em communities/{id} pelo lado do cliente. statuses/{id} não
// precisa de teste novo aqui: allow update já é `if false` incondicional (nenhuma
// mudança de Rules foi necessária lá).
let env
let owner
let outsider
let admin

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-treinos',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
  await env.clearFirestore()
  owner = env.authenticatedContext('owner').firestore()
  outsider = env.authenticatedContext('outsider').firestore()
  admin = env.authenticatedContext('admin').firestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'users/owner'), { role: 'user' })
    await setDoc(doc(db, 'users/outsider'), { role: 'user' })
    await setDoc(doc(db, 'users/admin'), { role: 'superadmin' })
    // Seed via Admin SDK real (createPromotion), simulado aqui só pra existir algo pra
    // ler -- os testes abaixo verificam exatamente que o cliente nunca conseguiria
    // gravar isto de verdade.
    await setDoc(doc(db, 'promotions/promo1'), {
      ownerId: 'owner',
      targetType: 'post',
      targetId: 'status1',
      communityId: 'comm1',
      packageId: 'post_boost_3d',
      cashAmount: 25,
      durationDays: 3,
      status: 'active',
      startedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 3 * 86400000),
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      clickCount: 0,
      createdAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'communities/comm1'), {
      name: 'Corrida',
      description: 'desc',
      isActive: true,
      createdBy: 'owner',
      createdAt: Timestamp.now(),
      ownerId: 'owner',
      promoted: true,
      promotedUntil: Timestamp.fromMillis(Date.now() + 3 * 86400000),
      activePromotionId: 'promo1',
    })
    // Comunidade "legada": criada antes da Fase 6 existir, sem promoted/promotedUntil/
    // activePromotionId. Precisa continuar 100% editável pelo dono sem nenhuma migração
    // -- esses três campos são opcionais no schema (isValidCommunity trata os três com
    // !('x' in data) || ...), nunca exigidos.
    await setDoc(doc(db, 'communities/legacyComm'), {
      name: 'Corrida antiga',
      description: 'desc',
      isActive: true,
      createdBy: 'owner',
      createdAt: Timestamp.now(),
      ownerId: 'owner',
    })
  })
})
after(async () => {
  if (env) await env.cleanup()
})

test('the owner can read their own promotion', async () => {
  await assertSucceeds(getDoc(doc(owner, 'promotions/promo1')))
})

test('a superadmin can read any promotion', async () => {
  await assertSucceeds(getDoc(doc(admin, 'promotions/promo1')))
})

test('another signed-in user cannot read someone else promotion', async () => {
  await assertFails(getDoc(doc(outsider, 'promotions/promo1')))
})

test('the client can never write a promotion directly -- not even the owner or an admin', async () => {
  const payload = {
    ownerId: 'owner',
    targetType: 'post',
    targetId: 'status1',
    communityId: 'comm1',
    packageId: 'post_boost_3d',
    cashAmount: 25,
    durationDays: 3,
    status: 'active',
    startedAt: Timestamp.now(),
    expiresAt: Timestamp.now(),
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    clickCount: 0,
    createdAt: Timestamp.now(),
  }
  await assertFails(setDoc(doc(owner, 'promotions/newone'), payload))
  await assertFails(setDoc(doc(admin, 'promotions/newone'), payload))
  await assertFails(updateDoc(doc(owner, 'promotions/promo1'), { clickCount: 999 }))
  await assertFails(updateDoc(doc(owner, 'promotions/promo1'), { status: 'cancelled' }))
  await assertFails(deleteDoc(doc(owner, 'promotions/promo1')))
  await assertFails(deleteDoc(doc(admin, 'promotions/promo1')))
})

// promoted/promotedUntil em communities: server-managed (Fase 6). O dono continua
// editando o resto normalmente; só esses dois campos ficam fora do alcance do cliente.
test('the community owner can still edit unrelated fields (e.g. description) while promoted/promotedUntil stay untouched', async () => {
  await assertSucceeds(updateDoc(doc(owner, 'communities/comm1'), { description: 'nova descrição' }))
})

test('the community owner cannot flip `promoted` directly, even to a plausible value', async () => {
  await assertFails(updateDoc(doc(owner, 'communities/comm1'), { promoted: false }))
})

test('the community owner cannot change `promotedUntil` directly', async () => {
  await assertFails(
    updateDoc(doc(owner, 'communities/comm1'), { promotedUntil: Timestamp.fromMillis(Date.now() + 999999999) })
  )
})

test('a superadmin also cannot change promoted/promotedUntil directly on a community', async () => {
  await assertFails(updateDoc(doc(admin, 'communities/comm1'), { promoted: false }))
  await assertFails(updateDoc(doc(admin, 'communities/comm1'), { promotedUntil: null }))
})

// activePromotionId (revisão final da Fase 6): sem ele, o feed não teria como saber
// QUAL promoção incrementar em recordPromotionEvent -- server-managed exatamente como
// promoted/promotedUntil, mesma imutabilidade.
test('the community owner cannot change `activePromotionId` directly, not even to null', async () => {
  await assertFails(updateDoc(doc(owner, 'communities/comm1'), { activePromotionId: null }))
  await assertFails(updateDoc(doc(owner, 'communities/comm1'), { activePromotionId: 'someone-elses-promo' }))
})

test('a superadmin also cannot change `activePromotionId` directly on a community', async () => {
  await assertFails(updateDoc(doc(admin, 'communities/comm1'), { activePromotionId: null }))
})

// Compatibilidade legada: uma comunidade sem promoted/promotedUntil/activePromotionId
// (criada antes da Fase 6) continua 100% editável pelo dono, sem exigir migração.
test('a legacy community without promoted/promotedUntil/activePromotionId remains fully editable by its owner', async () => {
  await assertSucceeds(updateDoc(doc(owner, 'communities/legacyComm'), { description: 'atualizada' }))
})

test('a legacy community still rejects a client trying to introduce `promoted`/`activePromotionId` for the first time', async () => {
  await assertFails(updateDoc(doc(owner, 'communities/legacyComm'), { promoted: true }))
  await assertFails(updateDoc(doc(owner, 'communities/legacyComm'), { activePromotionId: 'x' }))
})

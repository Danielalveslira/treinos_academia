import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  Timestamp,
} from 'firebase/firestore'

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
    // Seed feito com Admin SDK real (Cloud Function), simulado aqui só pra existir algo
    // pra ler -- as regras nunca deveriam aceitar o cliente escrevendo isto de verdade
    // (é exatamente o que os testes abaixo verificam).
    await setDoc(doc(db, 'users/owner/wallet/current'), {
      coinBalance: 3,
      lifetimeCoinsEarned: 3,
      cashBalance: 0,
    })
    await setDoc(doc(db, 'users/owner/economyTransactions/tx1'), {
      asset: 'coin',
      direction: 'credit',
      amount: 3,
      reason: 'daily_activity',
      createdAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'users/owner/economyDaily/2026-01-10'), {
      activeMinutes: 31,
      checkpointsCount: 2,
      activityRewardGranted: true,
    })
    await setDoc(doc(db, 'economyConfig/current'), {
      dailyActivity: { requiredMinutes: 30, rewardCoins: 3 },
      version: 1,
    })
    await setDoc(doc(db, 'statuses/status1'), {
      communityId: 'comm1',
      authorId: 'someone-else',
      type: 'text',
      text: 'oi',
      createdAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'statuses/status1/economyVotes/owner'), {
      userId: 'owner',
      authorId: 'someone-else',
      value: 1,
      charged: true,
      rewardState: 'pending',
    })
    // Contador de recompensa por post/dia (Fase 3) -- seed via Admin SDK real
    // (reward-settlement-service.js), simulado aqui só pra existir algo pra ler.
    await setDoc(doc(db, 'statuses/status1/economyRewardDaily/2026-02-10'), {
      coinsCredited: 3,
    })
    // Para o teste da consulta em lote (getMyEconomyVotesForStatuses): várias
    // publicações, com votos de usuários diferentes espalhados -- status4 fica de
    // propósito sem nenhum voto, e status3 só tem voto do outsider, nunca do owner.
    for (const statusId of ['status2', 'status3', 'status4']) {
      await setDoc(doc(db, `statuses/${statusId}`), {
        communityId: 'comm1',
        authorId: 'someone-else',
        type: 'text',
        text: 'oi',
        createdAt: Timestamp.now(),
      })
    }
    await setDoc(doc(db, 'statuses/status2/economyVotes/owner'), {
      userId: 'owner',
      authorId: 'someone-else',
      value: -1,
      charged: true,
      rewardState: 'ineligible',
    })
    await setDoc(doc(db, 'statuses/status3/economyVotes/outsider'), {
      userId: 'outsider',
      authorId: 'someone-else',
      value: 1,
      charged: true,
      rewardState: 'pending',
    })
    // EvoCash (Fase 4) -- seed via Admin SDK real (cash-purchase-service.js), simulado
    // aqui só pra existir algo pra ler.
    await setDoc(doc(db, 'cashPurchases/purchase1'), {
      userId: 'owner',
      packageId: 'pack_100',
      packageLabel: '100 EvoCash',
      cashAmount: 100,
      amountCentavos: 990,
      currency: 'BRL',
      configVersion: 1,
      paymentMethod: 'manual_pix',
      status: 'pending',
      createdAt: Timestamp.now(),
    })
  })
})

after(async () => {
  await env?.cleanup()
})

test('the owner can read their own wallet, ledger and daily activity summary', async () => {
  await assertSucceeds(getDoc(doc(owner, 'users/owner/wallet/current')))
  await assertSucceeds(getDoc(doc(owner, 'users/owner/economyTransactions/tx1')))
  await assertSucceeds(getDoc(doc(owner, 'users/owner/economyDaily/2026-01-10')))
})

test('a superadmin can read any user wallet, ledger and daily activity summary', async () => {
  await assertSucceeds(getDoc(doc(admin, 'users/owner/wallet/current')))
  await assertSucceeds(getDoc(doc(admin, 'users/owner/economyTransactions/tx1')))
  await assertSucceeds(getDoc(doc(admin, 'users/owner/economyDaily/2026-01-10')))
})

test('another signed-in user cannot read someone else wallet, ledger or daily activity summary', async () => {
  await assertFails(getDoc(doc(outsider, 'users/owner/wallet/current')))
  await assertFails(getDoc(doc(outsider, 'users/owner/economyTransactions/tx1')))
  await assertFails(getDoc(doc(outsider, 'users/owner/economyDaily/2026-01-10')))
})

test('the client can never write its own wallet, not even the owner or an admin', async () => {
  await assertFails(
    setDoc(doc(owner, 'users/owner/wallet/current'), {
      coinBalance: 999999,
      lifetimeCoinsEarned: 999999,
      cashBalance: 999999,
    })
  )
  await assertFails(
    updateDoc(doc(owner, 'users/owner/wallet/current'), { coinBalance: 999999 })
  )
  await assertFails(deleteDoc(doc(owner, 'users/owner/wallet/current')))
  await assertFails(
    setDoc(doc(admin, 'users/owner/wallet/current'), {
      coinBalance: 999999,
      lifetimeCoinsEarned: 999999,
      cashBalance: 999999,
    })
  )
})

test('the client can never write the ledger (append-only, backend-only)', async () => {
  await assertFails(
    setDoc(doc(owner, 'users/owner/economyTransactions/forged'), {
      asset: 'coin',
      direction: 'credit',
      amount: 999999,
      reason: 'daily_activity',
      createdAt: Timestamp.now(),
    })
  )
  await assertFails(
    updateDoc(doc(owner, 'users/owner/economyTransactions/tx1'), { amount: 999999 })
  )
  await assertFails(deleteDoc(doc(owner, 'users/owner/economyTransactions/tx1')))
})

test('the client can never write its own daily activity summary (server-authoritative minutes)', async () => {
  await assertFails(
    setDoc(doc(owner, 'users/owner/economyDaily/2026-01-11'), {
      activeMinutes: 999999,
      checkpointsCount: 1,
      activityRewardGranted: true,
    })
  )
  await assertFails(
    updateDoc(doc(owner, 'users/owner/economyDaily/2026-01-10'), { activeMinutes: 999999 })
  )
})

test('the owner can read their own economic vote (distinct collection from poll votes)', async () => {
  await assertSucceeds(getDoc(doc(owner, 'statuses/status1/economyVotes/owner')))
})

test('a superadmin can read any user economic vote', async () => {
  await assertSucceeds(getDoc(doc(admin, 'statuses/status1/economyVotes/owner')))
})

test('another signed-in user cannot read someone else economic vote', async () => {
  await assertFails(getDoc(doc(outsider, 'statuses/status1/economyVotes/owner')))
})

test('the client can never write an economic vote directly, not even the owner or an admin', async () => {
  await assertFails(
    setDoc(doc(owner, 'statuses/status1/economyVotes/owner'), {
      userId: 'owner',
      authorId: 'someone-else',
      value: 1,
      charged: true,
      rewardState: 'pending',
    })
  )
  await assertFails(updateDoc(doc(owner, 'statuses/status1/economyVotes/owner'), { value: -1 }))
  await assertFails(deleteDoc(doc(owner, 'statuses/status1/economyVotes/owner')))
  await assertFails(
    setDoc(doc(admin, 'statuses/status1/economyVotes/owner'), {
      userId: 'owner',
      authorId: 'someone-else',
      value: 1,
      charged: true,
      rewardState: 'pending',
    })
  )
})

test('only a superadmin can read the per-post reward-daily counter (Fase 3); no client can ever write it', async () => {
  await assertFails(getDoc(doc(owner, 'statuses/status1/economyRewardDaily/2026-02-10')))
  await assertFails(getDoc(doc(outsider, 'statuses/status1/economyRewardDaily/2026-02-10')))
  await assertSucceeds(getDoc(doc(admin, 'statuses/status1/economyRewardDaily/2026-02-10')))
  await assertFails(
    setDoc(doc(owner, 'statuses/status1/economyRewardDaily/2026-02-10'), { coinsCredited: 999999 })
  )
  await assertFails(
    setDoc(doc(admin, 'statuses/status1/economyRewardDaily/2026-02-10'), { coinsCredited: 999999 })
  )
})

test('any signed-in user can read economyConfig, but never write it (not even an admin)', async () => {
  await assertSucceeds(getDoc(doc(owner, 'economyConfig/current')))
  await assertFails(
    setDoc(doc(owner, 'economyConfig/current'), { dailyActivity: { requiredMinutes: 1, rewardCoins: 1 } })
  )
  await assertFails(
    setDoc(doc(admin, 'economyConfig/current'), { dailyActivity: { requiredMinutes: 1, rewardCoins: 1 } })
  )
})

test('the owner can read their own cash purchase; another user cannot; a superadmin can read any', async () => {
  await assertSucceeds(getDoc(doc(owner, 'cashPurchases/purchase1')))
  await assertFails(getDoc(doc(outsider, 'cashPurchases/purchase1')))
  await assertSucceeds(getDoc(doc(admin, 'cashPurchases/purchase1')))
})

test('the client can never write a cash purchase directly, not even the owner or an admin', async () => {
  const payload = {
    userId: 'owner',
    packageId: 'pack_100',
    packageLabel: '100 EvoCash',
    cashAmount: 999999,
    amountCentavos: 1,
    currency: 'BRL',
    configVersion: 1,
    paymentMethod: 'manual_pix',
    status: 'credited',
    createdAt: Timestamp.now(),
  }
  await assertFails(setDoc(doc(owner, 'cashPurchases/forged'), payload))
  await assertFails(updateDoc(doc(owner, 'cashPurchases/purchase1'), { status: 'credited' }))
  await assertFails(deleteDoc(doc(owner, 'cashPurchases/purchase1')))
  await assertFails(setDoc(doc(admin, 'cashPurchases/forged'), payload))
  await assertFails(updateDoc(doc(admin, 'cashPurchases/purchase1'), { status: 'credited' }))
})

// getMyEconomyVotesForStatuses (economyService.js): a mesma consulta real -- collection
// group + where(documentId(), 'in', refs) -- que o feed usa pra evitar N leituras
// separadas (1 por card). Contra o emulador de verdade, não uma fixture, e sujeita às
// Rules reais (nunca com env.withSecurityRulesDisabled), pra confirmar que a query em
// lote funciona E que o isolamento por uid continua garantido quando avaliado pelas
// regras de segurança, não só pela lógica do próprio client.
test('a batched collection-group query for several statuses returns only the caller own votes, real emulator + real Rules', async () => {
  const refs = ['status1', 'status2', 'status3', 'status4'].map((statusId) =>
    doc(owner, 'statuses', statusId, 'economyVotes', 'owner')
  )
  const snapshot = await assertSucceeds(
    getDocs(query(collectionGroup(owner, 'economyVotes'), where(documentId(), 'in', refs)))
  )
  const votesByStatusId = Object.fromEntries(
    snapshot.docs.map((item) => [item.ref.parent.parent.id, item.data()])
  )
  // status1 e status2: owner votou (1 e -1). status3: só o outsider votou -- nunca
  // deveria aparecer aqui, mesmo pedido explicitamente no "in" (a ref aponta pro
  // documento .../economyVotes/owner em status3, que nunca foi criado). status4: sem
  // voto nenhum de ninguém.
  assert.deepEqual(Object.keys(votesByStatusId).sort(), ['status1', 'status2'])
  assert.equal(votesByStatusId.status1.value, 1)
  assert.equal(votesByStatusId.status2.value, -1)
})

test('the same batched query for a different uid returns that uid own votes, never mixed with another user', async () => {
  const refs = ['status1', 'status2', 'status3', 'status4'].map((statusId) =>
    doc(outsider, 'statuses', statusId, 'economyVotes', 'outsider')
  )
  const snapshot = await assertSucceeds(
    getDocs(query(collectionGroup(outsider, 'economyVotes'), where(documentId(), 'in', refs)))
  )
  const foundStatusIds = snapshot.docs.map((item) => item.ref.parent.parent.id)
  assert.deepEqual(foundStatusIds, ['status3'])
})

test('a client cannot use the batched query to read another uid votes by constructing refs to that uid', async () => {
  // outsider tentando ler os votos de owner (refs terminando em ".../economyVotes/owner")
  // -- cada resultado possível falharia isOwner('owner') para quem está autenticado como
  // outsider, então a consulta inteira é negada (mesmo "list-rule gotcha" já documentado
  // para sponsoredAds/communityMembers neste projeto).
  const refs = ['status1', 'status2'].map((statusId) =>
    doc(outsider, 'statuses', statusId, 'economyVotes', 'owner')
  )
  await assertFails(
    getDocs(query(collectionGroup(outsider, 'economyVotes'), where(documentId(), 'in', refs)))
  )
})

test('a superadmin can run the same batched query against any uid', async () => {
  const refs = ['status1', 'status2'].map((statusId) =>
    doc(admin, 'statuses', statusId, 'economyVotes', 'owner')
  )
  const snapshot = await assertSucceeds(
    getDocs(query(collectionGroup(admin, 'economyVotes'), where(documentId(), 'in', refs)))
  )
  assert.equal(snapshot.size, 2)
})

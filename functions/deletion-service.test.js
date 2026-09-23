import { test } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createDeletionService } from './deletion-service.js'

// Admin SDK direto contra o emulador, mesmo padrão de rate-limit-service.test.js e
// progress-daily-service.test.js.
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
initializeApp({ projectId: 'demo-treinos-functions-test' })
const db = getFirestore()

const fakeAuth = {
  async updateUser() {},
  async revokeRefreshTokens() {},
  async deleteUser() {},
}
const fakeBucket = {
  file: () => ({ delete: async () => {} }),
  getFiles: async () => [[]],
}

function FakeHttpsError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

let counter = 0
function uid() {
  return `deletion-user-${Date.now()}-${counter++}`
}

async function runToCompletion(deletions, ref) {
  for (let i = 0; i < 30; i++) {
    await deletions.step(ref)
    const snapshot = await ref.get()
    if (snapshot.data()?.state === 'complete') return
  }
  throw new Error('deletion job did not complete in time')
}

// Fase 4: economyTransactions (ledger) deixou de ser apagado -- pode conter comprovante
// de dinheiro real (asset:'cash'), retenção temporária até política formal (ver
// comentário em deletion-service.js). wallet/economyDaily continuam sendo apagados
// normalmente aqui porque este teste usa cashBalance:0 e nenhuma compra pending -- o
// portão financeiro (testado abaixo) nem chega a bloquear.
test('deleting an account erases its wallet and economyDaily, but preserves economyTransactions (ledger financeiro)', async () => {
  const deletions = createDeletionService({
    db,
    auth: fakeAuth,
    bucket: fakeBucket,
    FieldValue,
    Timestamp,
    HttpsError: FakeHttpsError,
  })
  const adminId = uid()
  const targetUid = uid()
  await db.doc(`users/${adminId}`).set({ role: 'superadmin' })
  await db.doc(`users/${targetUid}`).set({ role: 'user' })
  await db.doc('maintenance/adminV1').set({ interactionsVersion: 1 })
  await db
    .doc(`users/${targetUid}/wallet/current`)
    .set({ coinBalance: 3, lifetimeCoinsEarned: 3, cashBalance: 0 })
  await db
    .doc(`users/${targetUid}/economyDaily/2026-01-10`)
    .set({ activeMinutes: 31, checkpointsCount: 2, activityRewardGranted: true })
  await db
    .doc(`users/${targetUid}/economyTransactions/tx1`)
    .set({ asset: 'coin', direction: 'credit', amount: 3 })

  const { id } = await deletions.queue('account', targetUid, adminId)
  const ref = db.doc(`deletionJobs/${id}`)
  await runToCompletion(deletions, ref)

  const [wallet, daily, transactions] = await Promise.all([
    db.collection(`users/${targetUid}/wallet`).get(),
    db.collection(`users/${targetUid}/economyDaily`).get(),
    db.collection(`users/${targetUid}/economyTransactions`).get(),
  ])
  assert.equal(wallet.empty, true)
  assert.equal(daily.empty, true)
  assert.equal(transactions.empty, false, 'ledger financeiro precisa sobreviver à exclusão')
})

test('account deletion removes the professional listing, owner lock, draft and global avatar manifest', async () => {
  const deletions = createDeletionService({
    db,
    auth: fakeAuth,
    bucket: fakeBucket,
    FieldValue,
    Timestamp,
    HttpsError: FakeHttpsError,
  })
  const adminId = uid()
  const targetUid = uid()
  const listingId = uid()
  await db.doc(`users/${adminId}`).set({ role: 'superadmin' })
  await db.doc(`users/${targetUid}`).set({ role: 'user' })
  await db.doc('maintenance/adminV1').set({ interactionsVersion: 1 })
  await db.doc(`professionalListingOwnerLocks/${targetUid}`).set({ ownerId: targetUid, listingId })
  await db.doc(`professionalListings/${listingId}`).set({ ownerId: targetUid })
  await db.doc(`professionalListingDrafts/${listingId}`).set({ ownerId: targetUid })
  await db.doc(`publishedProfessionalListings/${listingId}`).set({ publicationStatus: 'published' })
  await db.doc(`profileAvatarMedia/${uid()}`).set({ ownerId: targetUid })
  await db.doc(`users/${targetUid}/showcaseLegalAcceptances/1.0.0`).set({
    userId: targetUid,
    listingId,
    version: '1.0.0',
  })

  const { id } = await deletions.queue('account', targetUid, adminId)
  await runToCompletion(deletions, db.doc(`deletionJobs/${id}`))

  const snapshots = await Promise.all([
    db.doc(`professionalListingOwnerLocks/${targetUid}`).get(),
    db.doc(`professionalListings/${listingId}`).get(),
    db.doc(`professionalListingDrafts/${listingId}`).get(),
    db.doc(`publishedProfessionalListings/${listingId}`).get(),
  ])
  assert.ok(snapshots.every((snapshot) => !snapshot.exists))
  assert.equal(
    (await db.collection('profileAvatarMedia').where('ownerId', '==', targetUid).get()).empty,
    true
  )
  assert.equal(
    (await db.collection(`users/${targetUid}/showcaseLegalAcceptances`).get()).empty,
    true
  )
})

// Confirma que a limpeza pagina de verdade em vez de tentar apagar tudo de uma vez:
// mais documentos do que o tamanho de página interno de eraseQuery (100), então drenar
// a coleção precisa de várias chamadas a step() (cada uma processando no máximo uma
// página), nunca uma leitura/gravação gigante só. economyDaily (não mais
// economyTransactions, que passou a ser preservado na Fase 4) é a coleção que continua
// sendo apagada e pode crescer bastante por ano de uso.
test('an economyDaily collection larger than one deletion batch is drained safely across multiple step() calls', async () => {
  const deletions = createDeletionService({
    db,
    auth: fakeAuth,
    bucket: fakeBucket,
    FieldValue,
    Timestamp,
    HttpsError: FakeHttpsError,
  })
  const adminId = uid()
  const targetUid = uid()
  await db.doc(`users/${adminId}`).set({ role: 'superadmin' })
  await db.doc(`users/${targetUid}`).set({ role: 'user' })
  await db.doc('maintenance/adminV1').set({ interactionsVersion: 1 })

  const DAILY_DOC_COUNT = 130 // > o batchSize interno de eraseQuery (100)
  const seedBatch = db.batch()
  for (let i = 0; i < DAILY_DOC_COUNT; i++) {
    seedBatch.set(
      db.doc(`users/${targetUid}/economyDaily/2026-01-${String(i + 1).padStart(4, '0')}`),
      {
        activeMinutes: 0,
        checkpointsCount: 0,
      }
    )
  }
  await seedBatch.commit()

  const { id } = await deletions.queue('account', targetUid, adminId)
  const ref = db.doc(`deletionJobs/${id}`)

  let callsUsed = 0
  let observedPartialDrain = false
  for (let i = 0; i < 40; i++) {
    await deletions.step(ref)
    callsUsed++
    const remaining = (await db.collection(`users/${targetUid}/economyDaily`).get()).size
    if (remaining > 0 && remaining < DAILY_DOC_COUNT) observedPartialDrain = true
    const snapshot = await ref.get()
    if (snapshot.data()?.state === 'complete') break
  }

  const finalCount = (await db.collection(`users/${targetUid}/economyDaily`).get()).size
  assert.equal(finalCount, 0)
  assert.ok(
    observedPartialDrain,
    'deveria ter observado um estado intermediário (nem 0 nem 130 documentos) provando a paginação'
  )
  // ceil(130/100) = 2 chamadas que efetivamente apagam uma página (100, depois 30) --
  // eraseQuery sempre devolve false depois de apagar uma página não vazia, então cada
  // uma delas precisa da PRÓXIMA chamada a step() pra continuar -- mais 1 chamada final
  // em que eraseQuery encontra a coleção já vazia e devolve true, liberando os estágios
  // seguintes (publicProfiles/statistics, exclusão no Auth, batch final) na mesma
  // chamada. Não é uma estimativa: com todo o resto já vazio para este uid recém-criado,
  // esse é o número exato de chamadas até "complete".
  assert.equal(
    callsUsed,
    3,
    `esperava exatamente 3 chamadas a step() para drenar 130 documentos em páginas de 100, usou ${callsUsed}`
  )
})

// Fase 4: portão financeiro -- uma compra pending (refletida no cashPurchaseLock) trava
// a exclusão ANTES de qualquer etapa destrutiva, e o job sai do estado 'pending' (nunca
// mais reaparece na query de processDeletionJobs, que filtra state=='pending') -- ao
// contrário de um erro comum, isto não é "retentar a cada minuto".
test('a pending cash purchase (via cashPurchaseLock) blocks account deletion before any destructive step, without infinite retries', async () => {
  const deletions = createDeletionService({
    db,
    auth: fakeAuth,
    bucket: fakeBucket,
    FieldValue,
    Timestamp,
    HttpsError: FakeHttpsError,
  })
  const adminId = uid()
  const targetUid = uid()
  await db.doc(`users/${adminId}`).set({ role: 'superadmin' })
  await db.doc(`users/${targetUid}`).set({ role: 'user' })
  await db.doc('maintenance/adminV1').set({ interactionsVersion: 1 })
  await db
    .doc(`users/${targetUid}/wallet/cashPurchaseLock`)
    .set({ pendingPurchaseId: 'some-purchase-id' })
  await db.doc(`communityMembers/c1_${targetUid}`).set({ communityId: 'c1', userId: targetUid })

  const { id } = await deletions.queue('account', targetUid, adminId)
  const ref = db.doc(`deletionJobs/${id}`)
  await deletions.step(ref)

  const job = await ref.get()
  assert.equal(job.data().state, 'blocked_financial_review')
  assert.equal(job.data().blockReason, 'pending_cash_purchase')
  assert.equal(job.data().stage, 0, 'nenhuma etapa destrutiva avançou')
  assert.equal(
    (await db.doc(`communityMembers/c1_${targetUid}`).get()).exists,
    true,
    'nada destrutivo deveria ter rodado'
  )

  // "sem retries infinitos": um job blocked não é 'pending', então não seria pego de
  // novo pela query de processDeletionJobs (where state=='pending'). Chamar step() de
  // novo diretamente também não reprocessa destrutivamente -- só reavalia o mesmo portão.
  await deletions.step(ref)
  const jobAgain = await ref.get()
  assert.equal(jobAgain.data().state, 'blocked_financial_review')
  assert.equal(jobAgain.data().stage, 0)
})

// Fase 4: cashBalance > 0 sozinho (sem nenhuma compra pending) também bloqueia --
// "créditos comprados não podem desaparecer só porque wallet/current foi apagado" vira,
// na prática, "a exclusão nem chega a apagar wallet/current enquanto isso for verdade".
test('a positive cashBalance alone (no pending purchase) blocks account deletion', async () => {
  const deletions = createDeletionService({
    db,
    auth: fakeAuth,
    bucket: fakeBucket,
    FieldValue,
    Timestamp,
    HttpsError: FakeHttpsError,
  })
  const adminId = uid()
  const targetUid = uid()
  await db.doc(`users/${adminId}`).set({ role: 'superadmin' })
  await db.doc(`users/${targetUid}`).set({ role: 'user' })
  await db.doc('maintenance/adminV1').set({ interactionsVersion: 1 })
  await db
    .doc(`users/${targetUid}/wallet/current`)
    .set({ coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 550 })

  const { id } = await deletions.queue('account', targetUid, adminId)
  const ref = db.doc(`deletionJobs/${id}`)
  await deletions.step(ref)

  const job = await ref.get()
  assert.equal(job.data().state, 'blocked_financial_review')
  assert.equal(job.data().blockReason, 'positive_cash_balance')
  const wallet = await db.doc(`users/${targetUid}/wallet/current`).get()
  assert.equal(
    wallet.data().cashBalance,
    550,
    'saldo intacto -- exclusão não chegou a apagar o wallet'
  )
})

// Fase 3: economyRewardDaily (contador de recompensa por post/dia) precisa sumir junto
// com o post excluído, mesma lista de subcoleções já drenada para votes/participants/
// economyVotes -- nenhum índice novo, nenhuma query cross-cutting nova.
test('deleting a status erases its economyRewardDaily subcollection along with votes/participants/economyVotes', async () => {
  const deletions = createDeletionService({
    db,
    auth: fakeAuth,
    bucket: fakeBucket,
    FieldValue,
    Timestamp,
    HttpsError: FakeHttpsError,
  })
  const statusId = uid()
  await db.doc(`statuses/${statusId}/economyRewardDaily/2026-02-10`).set({ coinsCredited: 3 })
  await db.doc(`statuses/${statusId}/economyVotes/voter1`).set({ userId: 'voter1', value: 1 })

  await deletions.queueDeleted('status', statusId)
  const ref = db.doc(`deletionJobs/status_${statusId}`)
  await runToCompletion(deletions, ref)

  const [rewardDaily, economyVotes] = await Promise.all([
    db.collection(`statuses/${statusId}/economyRewardDaily`).get(),
    db.collection(`statuses/${statusId}/economyVotes`).get(),
  ])
  assert.equal(rewardDaily.empty, true)
  assert.equal(economyVotes.empty, true)
})

// Fase 5 (privilégios): o dono de uma comunidade (communities.ownerId) tem, dentro
// dela, os mesmos poderes administrativos do superadmin -- incluindo excluí-la. `entity`
// já É o documento da comunidade lido dentro de queue(), então isto não custa nenhuma
// leitura extra.
test('the owner of a community (not a superadmin) can queue its deletion', async () => {
  const deletions = createDeletionService({
    db,
    auth: fakeAuth,
    bucket: fakeBucket,
    FieldValue,
    Timestamp,
    HttpsError: FakeHttpsError,
  })
  const ownerId = uid()
  const communityId = uid()
  await db.doc(`users/${ownerId}`).set({ role: 'user' })
  await db.doc(`communities/${communityId}`).set({ ownerId, createdBy: ownerId, isActive: true })

  const { id } = await deletions.queue('community', communityId, ownerId)
  const ref = db.doc(`deletionJobs/${id}`)
  await runToCompletion(deletions, ref)

  assert.equal((await db.doc(`communities/${communityId}`).get()).exists, false)
})

test('a regular user who is neither superadmin nor the community owner cannot queue its deletion', async () => {
  const deletions = createDeletionService({
    db,
    auth: fakeAuth,
    bucket: fakeBucket,
    FieldValue,
    Timestamp,
    HttpsError: FakeHttpsError,
  })
  const ownerId = uid()
  const outsiderId = uid()
  const communityId = uid()
  await db.doc(`users/${outsiderId}`).set({ role: 'user' })
  await db.doc(`communities/${communityId}`).set({ ownerId, createdBy: ownerId, isActive: true })

  await assert.rejects(
    () => deletions.queue('community', communityId, outsiderId),
    (error) => error.code === 'permission-denied'
  )
  assert.equal(
    (await db.doc(`communities/${communityId}`).get()).exists,
    true,
    'nada deveria ter mudado'
  )
})

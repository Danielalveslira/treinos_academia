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

function buildTrackingAuth() {
  const calls = { updateUser: [], revokeRefreshTokens: [], deleteUser: [] }
  return {
    calls,
    async updateUser(targetUid, patch) {
      calls.updateUser.push({ uid: targetUid, patch })
    },
    async revokeRefreshTokens(targetUid) {
      calls.revokeRefreshTokens.push(targetUid)
    },
    async deleteUser(targetUid) {
      calls.deleteUser.push(targetUid)
    },
  }
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

// A limpeza ainda pagina de verdade internamente (eraseQuery nunca lê/apaga mais que
// batchSize=100 documentos por página), mas step() agora processa página após página,
// estágio após estágio, até esgotar um orçamento de tempo (deadline) -- não mais uma
// página por chamada. Uma conta com mais documentos do que uma única página (100)
// precisa terminar numa ÚNICA chamada a step(), já que o orçamento padrão (4 minutos)
// sobra de longe para isso. É exatamente essa mudança que resolve "a exclusão demora
// excessivamente": antes, o agendador (a cada 1 minuto, até 10 jobs por execução)
// precisava de uma volta inteira por página de cada estágio de cada conta.
test('an economyDaily collection larger than one internal page is fully drained within a single step() call', async () => {
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

  await deletions.step(ref)

  const [job, remaining] = await Promise.all([
    ref.get(),
    db.collection(`users/${targetUid}/economyDaily`).get(),
  ])
  assert.equal(job.data().state, 'complete', 'uma única chamada deveria bastar dentro do orçamento padrão')
  assert.equal(remaining.size, 0)
})

// Prova que o orçamento de tempo (deadline) é respeitado de verdade -- não só "existe
// mas nunca importa". Um deadline já vencido faz step() não avançar estágio nenhum
// nesta chamada (sem perder nem corromper o que já foi apagado, já que cada página
// continua sendo seu próprio commit atômico); uma chamada seguinte, com o orçamento
// padrão, retoma exatamente de onde parou e termina.
test('a spent deadline makes step() advance nothing this call; a later call with budget resumes and finishes', async () => {
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
  await db.doc(`communityMembers/c1_${targetUid}`).set({ communityId: 'c1', userId: targetUid })

  const { id } = await deletions.queue('account', targetUid, adminId)
  const ref = db.doc(`deletionJobs/${id}`)

  await deletions.step(ref, { deadline: Date.now() - 1 })
  const stalled = await ref.get()
  assert.equal(stalled.data().state, 'pending')
  assert.equal(stalled.data().stage, 0, 'nenhum estágio deveria ter avançado sem orçamento')
  assert.equal(
    (await db.doc(`communityMembers/c1_${targetUid}`).get()).exists,
    true,
    'nada destrutivo deveria ter rodado sem orçamento de tempo'
  )

  await deletions.step(ref)
  const finished = await ref.get()
  assert.equal(finished.data().state, 'complete')
  assert.equal((await db.doc(`communityMembers/c1_${targetUid}`).get()).exists, false)
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

// Fechamento da auditoria de exclusão: a conta precisa parar de conseguir logar assim
// que a exclusão é SOLICITADA, não só quando step() chega ao estágio 0 (que pode
// esperar até ~1 minuto pelo próximo tick do agendador, mais se a fila estiver
// ocupada). queue() agora desativa a conta no Auth de forma síncrona, antes de devolver
// a resposta -- sem nunca esperar o agendador para isso.
test('queue() disables the Auth account synchronously, before any step() call ever runs', async () => {
  const trackingAuth = buildTrackingAuth()
  const deletions = createDeletionService({
    db,
    auth: trackingAuth,
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

  await deletions.queue('account', targetUid, adminId)

  assert.deepEqual(
    trackingAuth.calls.updateUser,
    [{ uid: targetUid, patch: { disabled: true } }],
    'the account must already be disabled by the time queue() returns'
  )
  assert.deepEqual(trackingAuth.calls.revokeRefreshTokens, [targetUid])
  // step() ainda não rodou nenhuma vez -- confirma que a desativação em queue() não
  // depende do job já ter sido processado.
  const job = await db.doc(`deletionJobs/account_${targetUid}`).get()
  assert.equal(job.data().stage, 0)
})

// A trava do Firestore (deletionJobs/account_{uid}) já bloqueia toda operação nova
// imediatamente (isSignedIn() em firestore.rules); isto prova que step()'s próprio
// estágio 0 continua idempotente mesmo depois de queue() já ter desativado a conta --
// nenhum erro, mesmo chamando updateUser({disabled:true}) de novo sobre uma conta que
// queue() já desativou.
test('step()\'s own stage 0 auth-disable is a safe idempotent no-op after queue() already did it', async () => {
  const trackingAuth = buildTrackingAuth()
  const deletions = createDeletionService({
    db,
    auth: trackingAuth,
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

  const { id } = await deletions.queue('account', targetUid, adminId)
  await runToCompletion(deletions, db.doc(`deletionJobs/${id}`))

  assert.equal(trackingAuth.calls.updateUser.length, 2, 'once from queue(), once from stage 0')
  assert.equal(trackingAuth.calls.deleteUser.length, 1)
})

// Fechamento da auditoria: duas execuções do agendador podem se sobrepor de verdade
// (o schedule dispara a cada minuto mesmo que a anterior ainda não tenha terminado,
// ver comentário em processDeletionJobs/index.js) -- prova que chamar step() duas
// vezes CONCORRENTEMENTE sobre o MESMO job nunca duplica trabalho nem corrompe o
// resultado: a lease por job (reivindicada dentro de uma transação) garante que só
// uma das duas execuções realmente processa cada rodada.
test('two concurrent step() calls on the same job never double-process or corrupt it', async () => {
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
  await db.doc(`communityMembers/c1_${targetUid}`).set({ communityId: 'c1', userId: targetUid })

  const { id } = await deletions.queue('account', targetUid, adminId)
  const ref = db.doc(`deletionJobs/${id}`)

  // Concorrência real: as duas chamadas competem pela mesma lease ao mesmo tempo, não
  // uma depois da outra.
  await Promise.all([deletions.step(ref), deletions.step(ref)])

  // Pode não ter terminado numa única rodada concorrente (uma das duas pode ter sido
  // descartada pela lease antes de fazer qualquer progresso) -- completa com chamadas
  // sequenciais normais, provando que nada ficou preso ou inconsistente.
  await runToCompletion(deletions, ref)
  const finished = await ref.get()
  assert.equal(finished.data().state, 'complete')
  assert.equal(
    (await db.doc(`communityMembers/c1_${targetUid}`).get()).exists,
    false,
    'a exclusão real ainda precisa ter acontecido, exatamente uma vez'
  )
})

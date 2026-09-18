import { test } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createConfigService } from './config-service.js'
import { createWalletService } from './wallet-service.js'
import { createLedgerService } from './ledger-service.js'
import { createVoteService } from './vote-service.js'
import { todayKey } from './activity-core.js'

// Admin SDK direto contra o emulador, mesmo padrão de activity-service.test.js: esta
// lógica roda dentro de uma Cloud Function callable (Admin SDK, ignora firestore.rules)
// -- as rules em si são cobertas à parte em tests/economy-rules.test.mjs.
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
initializeApp({ projectId: 'demo-treinos-functions-test' })
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
  const getEconomyConfig = createConfigService({ db, log: { warn: () => {} } })
  const wallet = createWalletService({ db, FieldValue })
  const ledger = createLedgerService({ db, FieldValue })
  return createVoteService({
    db,
    FieldValue,
    wallet,
    ledger,
    getEconomyConfig,
    assertWritableAccount,
    HttpsError: FakeHttpsError,
    ...(now ? { now } : {}),
  })
}

let counter = 0
function uid() {
  return `voter-${Date.now()}-${counter++}`
}

async function seedCommunityAndStatus({ communityId, statusId, authorId, expiresInMs = 60 * 60 * 1000 }) {
  await db.doc(`statuses/${statusId}`).set({
    communityId,
    authorId,
    type: 'text',
    text: 'oi',
    expiresAt: Timestamp.fromMillis(Date.now() + expiresInMs),
  })
}

async function joinCommunity(communityId, voterUid) {
  await db.doc(`communityMembers/${communityId}_${voterUid}`).set({ communityId, userId: voterUid })
}

async function fundWallet(voterUid, coinBalance) {
  await db
    .doc(`users/${voterUid}/wallet/current`)
    .set({ coinBalance, lifetimeCoinsEarned: coinBalance, cashBalance: 0 })
}

async function getWallet(testUid) {
  const snapshot = await db.doc(`users/${testUid}/wallet/current`).get()
  return snapshot.exists ? snapshot.data() : null
}

async function getVote(statusId, voterUid) {
  const snapshot = await db.doc(`statuses/${statusId}/economyVotes/${voterUid}`).get()
  return snapshot.exists ? snapshot.data() : null
}

async function getDaily(testUid, dateKey) {
  const snapshot = await db.doc(`users/${testUid}/economyDaily/${dateKey}`).get()
  return snapshot.exists ? snapshot.data() : null
}

async function countLedgerEntries(testUid) {
  const snapshot = await db.collection(`users/${testUid}/economyTransactions`).get()
  return snapshot.size
}

test('primeiro voto (positivo): cobra 3 EvoCoins, cria o voto, grava o ledger e conta no limite diário', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService({ now: () => Date.now() })

  const result = await voteOnPost(voterUid, statusId, 1)
  assert.equal(result.voted, true)
  assert.equal(result.action, 'create')
  assert.equal(result.charged, true)
  assert.equal(result.costCoins, 3)

  const wallet = await getWallet(voterUid)
  assert.equal(wallet.coinBalance, 7)
  assert.equal(wallet.lifetimeCoinsEarned, 10, 'débito nunca deveria mexer em lifetimeCoinsEarned')

  const vote = await getVote(statusId, voterUid)
  assert.equal(vote.value, 1)
  assert.equal(vote.charged, true)
  assert.equal(vote.authorId, authorId)
  assert.equal(vote.rewardState, 'pending')
  assert.ok(vote.rewardPendingAt, 'evento elegível precisa estar carimbado para o settlement usar')
  assert.equal(vote.rewardDayKey, todayKey(Date.now()), 'usa o dia do evento, não um valor arbitrário')

  assert.equal(await countLedgerEntries(voterUid), 1)

  const daily = await getDaily(voterUid, todayKey(Date.now()))
  assert.equal(daily.votesCharged, 1)
  assert.equal(daily.voteCoinsSpent, 3)
})

test('primeiro voto negativo também custa 3 EvoCoins, mas nunca fica pending para o autor', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()

  await voteOnPost(voterUid, statusId, -1)
  const wallet = await getWallet(voterUid)
  assert.equal(wallet.coinBalance, 7)
  const vote = await getVote(statusId, voterUid)
  assert.equal(vote.value, -1)
  assert.equal(vote.rewardState, 'ineligible')
})

test('trocar de positivo para negativo não cobra de novo', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()

  await voteOnPost(voterUid, statusId, 1)
  const result = await voteOnPost(voterUid, statusId, -1)
  assert.equal(result.voted, true)
  assert.equal(result.action, 'switch')
  assert.equal(result.charged, false)

  const wallet = await getWallet(voterUid)
  assert.equal(wallet.coinBalance, 7, 'nenhuma cobrança adicional na troca')
  const vote = await getVote(statusId, voterUid)
  assert.equal(vote.value, -1)
  assert.equal(vote.rewardState, 'ineligible')
  assert.equal(await countLedgerEntries(voterUid), 1)
})

// "já foi cobrado" sobrevive à remoção porque NUNCA é apagado: charged=true, uma vez
// gravado no documento de voto (statuses/{id}/economyVotes/{uid}), só é regravado como
// true de novo em toda chamada subsequente (ver vote-service.js, ramo action !== 'create'
// -- que cobre switch E remove) -- não existe nenhum caminho de código que grave
// charged=false depois do primeiro voto. decideVoteAction (vote-core.js) só entra no
// ramo 'create' (o único que debita/grava ledger/incrementa o limite diário) quando
// NENHUM documento de voto existe ainda; uma vez que ele existe (mesmo com value=null,
// removido), toda chamada seguinte cai em 'switch' ou 'noop', nunca de volta em 'create'.
test('votar → pagar → remover → votar de novo no mesmo status: nenhum novo débito, votesCharged, voteCoinsSpent ou ledger debit', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  const now = Date.now()
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService({ now: () => now })
  const dateKey = todayKey(now)

  // 1. votar (primeiro voto -- só aqui existe cobrança)
  const first = await voteOnPost(voterUid, statusId, 1)
  assert.equal(first.action, 'create')
  assert.equal(first.charged, true)

  // 2. pagar -- conferido logo após o primeiro voto, antes de qualquer remoção/re-voto.
  let wallet = await getWallet(voterUid)
  assert.equal(wallet.coinBalance, 7)
  let daily = await getDaily(voterUid, dateKey)
  assert.equal(daily.votesCharged, 1)
  assert.equal(daily.voteCoinsSpent, 3)
  assert.equal(await countLedgerEntries(voterUid), 1)

  // 3. remover (sem reembolso, charged permanece true no documento)
  const removal = await voteOnPost(voterUid, statusId, null)
  assert.equal(removal.action, 'remove')
  assert.equal(removal.charged, false)
  let vote = await getVote(statusId, voterUid)
  assert.equal(vote.value, null)
  assert.equal(vote.charged, true, 'charged nunca volta a false -- é isto que impede a recobrança abaixo')

  // 4. votar de novo no mesmo status -- resultado obrigatório: nada novo.
  const revote = await voteOnPost(voterUid, statusId, 1)
  assert.equal(revote.action, 'switch', 'documento de voto já existe -- nunca mais passa por "create"')
  assert.equal(revote.charged, false, 'nenhum novo débito')

  wallet = await getWallet(voterUid)
  assert.equal(wallet.coinBalance, 7, 'saldo idêntico ao de depois do primeiro voto -- nenhum novo débito')

  daily = await getDaily(voterUid, dateKey)
  assert.equal(daily.votesCharged, 1, 'nenhum novo votesCharged')
  assert.equal(daily.voteCoinsSpent, 3, 'nenhum novo voteCoinsSpent')

  assert.equal(await countLedgerEntries(voterUid), 1, 'nenhum novo ledger debit')
})

test('votar de novo com o mesmo valor (clique duplo) é um noop -- nenhuma escrita, nenhuma cobrança', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()

  await voteOnPost(voterUid, statusId, 1)
  const before = await getVote(statusId, voterUid)
  const repeat = await voteOnPost(voterUid, statusId, 1)
  assert.equal(repeat.voted, false)
  assert.equal(repeat.action, 'noop')
  const after = await getVote(statusId, voterUid)
  assert.deepEqual(after, before)
  const wallet = await getWallet(voterUid)
  assert.equal(wallet.coinBalance, 7)
})

test('remover um voto que nunca existiu é um noop', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  const voteOnPost = buildService()

  const result = await voteOnPost(voterUid, statusId, null)
  assert.equal(result.action, 'noop')
  assert.equal(await getVote(statusId, voterUid), null)
})

test('sem auto-voto: o autor não pode votar na própria publicação', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, authorId)
  await fundWallet(authorId, 10)
  const voteOnPost = buildService()

  await assert.rejects(() => voteOnPost(authorId, statusId, 1), /própria publicação/)
  assert.equal(await getVote(statusId, authorId), null)
  assert.equal((await getWallet(authorId)).coinBalance, 10)
})

test('votar numa publicação inexistente falha com not-found, sem cobrar nada', async () => {
  const voterUid = uid()
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()
  await assert.rejects(() => voteOnPost(voterUid, `s-${uid()}`, 1))
  assert.equal((await getWallet(voterUid)).coinBalance, 10)
})

test('votar numa publicação expirada é rejeitado', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId, expiresInMs: -1000 })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()
  await assert.rejects(() => voteOnPost(voterUid, statusId, 1), /expirou/)
})

test('quem não participa da comunidade não pode votar', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  // Sem joinCommunity de propósito.
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()
  await assert.rejects(() => voteOnPost(voterUid, statusId, 1), /comunidade/)
  assert.equal((await getWallet(voterUid)).coinBalance, 10)
})

test('quem está restrito na comunidade não pode votar, mesmo sendo membro', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await db.doc(`communityRestrictions/${communityId}_${voterUid}`).set({ userId: voterUid, communityId })
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()
  await assert.rejects(() => voteOnPost(voterUid, statusId, 1))
  assert.equal((await getWallet(voterUid)).coinBalance, 10)
})

test('uma conta com banimento permanente (system_ban) não pode votar', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await db.doc(`accountRestrictions/${voterUid}`).set({ action: 'system_ban' })
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()
  await assert.rejects(() => voteOnPost(voterUid, statusId, 1))
})

test('uma suspensão temporária já vencida não bloqueia o voto', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await db.doc(`accountRestrictions/${voterUid}`).set({
    action: 'temporary_suspension',
    until: Timestamp.fromMillis(Date.now() - 1000),
  })
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()
  const result = await voteOnPost(voterUid, statusId, 1)
  assert.equal(result.voted, true)
})

test('uma suspensão temporária ainda ativa bloqueia o voto', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await db.doc(`accountRestrictions/${voterUid}`).set({
    action: 'temporary_suspension',
    until: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
  })
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()
  await assert.rejects(() => voteOnPost(voterUid, statusId, 1))
})

test('saldo insuficiente impede o primeiro voto, sem criar carteira negativa nem o voto', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 2) // custo é 3
  const voteOnPost = buildService()
  await assert.rejects(() => voteOnPost(voterUid, statusId, 1), /insuficiente/)
  const wallet = await getWallet(voterUid)
  assert.equal(wallet.coinBalance, 2, 'saldo não deveria ter mudado')
  assert.equal(await getVote(statusId, voterUid), null)
  assert.equal(await countLedgerEntries(voterUid), 0)
})

test('sem nenhuma carteira ainda (saldo implícito zero), o primeiro voto também é recusado por saldo insuficiente', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  const voteOnPost = buildService()
  await assert.rejects(() => voteOnPost(voterUid, statusId, 1), /insuficiente/)
  assert.equal(await getWallet(voterUid), null)
})

test('limite diário de votos: o 11º voto pago do dia é recusado, mas trocar/remover votos já pagos nunca conta', async () => {
  const communityId = `c-${uid()}`
  const voterUid = uid()
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 100)
  const voteOnPost = buildService()

  const statusIds = []
  for (let i = 0; i < 10; i++) {
    const authorId = uid()
    const statusId = `s-${uid()}`
    await seedCommunityAndStatus({ communityId, statusId, authorId })
    statusIds.push(statusId)
    const result = await voteOnPost(voterUid, statusId, 1)
    assert.equal(result.charged, true)
  }

  // Trocar/remover votos já pagos não deveria consumir o limite diário.
  await voteOnPost(voterUid, statusIds[0], -1) // switch
  await voteOnPost(voterUid, statusIds[1], null) // remove

  const authorId = uid()
  const eleventhStatusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId: eleventhStatusId, authorId })
  await assert.rejects(() => voteOnPost(voterUid, eleventhStatusId, 1), /[Ll]imite/)

  const daily = await getDaily(voterUid, todayKey(Date.now()))
  assert.equal(daily.votesCharged, 10)
  const wallet = await getWallet(voterUid)
  assert.equal(wallet.coinBalance, 100 - 10 * 3)
})

test('requisições simultâneas do primeiro voto na mesma publicação cobram uma única vez', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 30)
  const voteOnPost = buildService()

  const results = await Promise.all(Array.from({ length: 5 }, () => voteOnPost(voterUid, statusId, 1)))
  const chargedCount = results.filter((r) => r.charged).length
  assert.equal(chargedCount, 1)

  const wallet = await getWallet(voterUid)
  assert.equal(wallet.coinBalance, 27)
  assert.equal(await countLedgerEntries(voterUid), 1)
  const daily = await getDaily(voterUid, todayKey(Date.now()))
  assert.equal(daily.votesCharged, 1)
})

test('conta em exclusão nunca consegue votar', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 10)
  await db.doc(`deletionJobs/account_${voterUid}`).set({ state: 'pending' })
  const voteOnPost = buildService()
  await assert.rejects(() => voteOnPost(voterUid, statusId, 1))
  assert.equal((await getWallet(voterUid)).coinBalance, 10)
})

// Simula o estado que a Fase 3 (settlement, ainda não implementada) deixaria depois de
// creditar o autor: rewardState: 'processed'. Preparação, não implementação -- nenhum
// crédito ao autor acontece aqui, só confirma que vote-service.js nunca desfaz esse
// marcador quando o votante troca, remove ou revota depois.
test('trocar/remover/revotar nunca redefine rewardState de volta para pending/ineligible depois de já processado (Fase 3)', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()

  await voteOnPost(voterUid, statusId, 1)
  // Simula a Fase 3 já tendo processado este voto positivo (autor já creditado).
  await db.doc(`statuses/${statusId}/economyVotes/${voterUid}`).set(
    { rewardState: 'processed' },
    { merge: true }
  )

  await voteOnPost(voterUid, statusId, -1) // switch
  assert.equal((await getVote(statusId, voterUid)).rewardState, 'processed')

  await voteOnPost(voterUid, statusId, null) // remove
  assert.equal((await getVote(statusId, voterUid)).rewardState, 'processed')

  await voteOnPost(voterUid, statusId, 1) // revoto
  assert.equal((await getVote(statusId, voterUid)).rewardState, 'processed')
})

// Pré-requisito estrutural para "reward no máximo uma vez por (votante, status)": o ID
// determinístico (economyVotes/{uid}) garante que só existe UM documento de voto por
// par, para sempre -- não importa quantas vezes o valor mude, nunca há um segundo
// documento (e portanto nunca um segundo rewardState) para a mesma dupla. Combinado com
// 'processed' sendo permanente (teste acima), isto é o que torna seguro para a Fase 3
// creditar o autor no máximo uma vez: ela só precisa consultar rewardState == 'pending'
// e virar 'processed' atomicamente -- nunca vai encontrar dois registros para a mesma
// combinação nem um que "voltou" a pending depois de processado.
test('um par (votante, status) nunca tem mais de um documento de voto, mesmo depois de vários create/switch/remove/revoto', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()

  await voteOnPost(voterUid, statusId, 1) // create
  await voteOnPost(voterUid, statusId, -1) // switch
  await voteOnPost(voterUid, statusId, null) // remove
  await voteOnPost(voterUid, statusId, 1) // revoto (switch)
  await voteOnPost(voterUid, statusId, -1) // switch de novo

  const votes = await db.collection(`statuses/${statusId}/economyVotes`).get()
  assert.equal(votes.size, 1, 'nunca deveria existir mais de 1 documento para este par')
  assert.equal(votes.docs[0].id, voterUid, 'o único documento é sempre o de ID determinístico = uid do votante')
})

// rewardPendingAt/rewardDayKey (seção 2 da auditoria de Fase 3): o settlement precisa
// do dia do EVENTO ELEGÍVEL, não do dia em que ele processou. Este teste prova o ciclo
// de vida completo: carimba ao entrar em pending, limpa ao virar ineligible, e carimba
// de NOVO (evento novo) se o votante voltar a positivo depois.
test('rewardPendingAt/rewardDayKey são carimbados ao entrar em pending e limpos ao virar ineligible', async () => {
  const communityId = `c-${uid()}`
  const authorId = uid()
  const voterUid = uid()
  const statusId = `s-${uid()}`
  await seedCommunityAndStatus({ communityId, statusId, authorId })
  await joinCommunity(communityId, voterUid)
  await fundWallet(voterUid, 10)
  const voteOnPost = buildService()

  // Primeiro voto negativo: nunca fica pending, nunca carimba nada.
  await voteOnPost(voterUid, statusId, -1)
  let vote = await getVote(statusId, voterUid)
  assert.equal(vote.rewardState, 'ineligible')
  assert.equal(vote.rewardPendingAt ?? null, null)
  assert.equal(vote.rewardDayKey ?? null, null)

  // Troca para positivo: evento elegível novo, carimbado agora.
  await voteOnPost(voterUid, statusId, 1)
  vote = await getVote(statusId, voterUid)
  assert.equal(vote.rewardState, 'pending')
  const firstPendingAt = vote.rewardPendingAt
  assert.ok(firstPendingAt)
  assert.equal(vote.rewardDayKey, todayKey(Date.now()))

  // Troca de volta para negativo: limpa os dois campos, sem deixar lixo.
  await voteOnPost(voterUid, statusId, -1)
  vote = await getVote(statusId, voterUid)
  assert.equal(vote.rewardState, 'ineligible')
  assert.equal(vote.rewardPendingAt ?? null, null)
  assert.equal(vote.rewardDayKey ?? null, null)

  // Volta para positivo de novo: é um evento elegível NOVO -- outro carimbo, não reaproveita o primeiro.
  await voteOnPost(voterUid, statusId, 1)
  vote = await getVote(statusId, voterUid)
  assert.equal(vote.rewardState, 'pending')
  assert.ok(vote.rewardPendingAt)
  assert.notEqual(
    vote.rewardPendingAt.toMillis(),
    firstPendingAt.toMillis(),
    'reentrar em pending depois de ineligible é um evento elegível novo, não reaproveita o carimbo antigo'
  )
})

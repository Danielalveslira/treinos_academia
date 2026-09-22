import { test } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createConfigService, DEFAULT_ECONOMY_CONFIG } from './config-service.js'
import { createWalletService } from './wallet-service.js'
import { createLedgerService } from './ledger-service.js'
import { createVoteService } from './vote-service.js'
import {
  createRewardSettlementService,
  SETTLEMENT_FUNCTION_TIMEOUT_SECONDS,
  LEASE_DURATION_MS,
} from './reward-settlement-service.js'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
// Projeto PRÓPRIO, isolado de demo-treinos-functions-test: o settlement descobre votos
// via collection-group query GLOBAL (sem escopo por teste), então rodar no mesmo
// projeto que vote-service.test.js/activity-service.test.js -- que legitimamente deixam
// votos 'pending' sem nunca liquidá-los, já que testam a Fase 2 isoladamente -- faria
// esses votos vazarem para as consultas de descoberta daqui quando os arquivos rodam
// concorrentemente (node --test roda arquivos diferentes em processos separados, todos
// batendo no mesmo emulador). O emulador trata cada projectId como um banco totalmente
// independente, sem nenhuma configuração extra -- mesmo padrão já usado para separar
// demo-treinos (rules) de demo-treinos-functions-test (functions) neste projeto.
initializeApp({ projectId: 'demo-treinos-settlement-test' })
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

function buildSettlement({ now, ...overrides } = {}) {
  const getEconomyConfig = createConfigService({ db, log: { warn: () => {} } })
  const wallet = createWalletService({ db, FieldValue })
  const ledger = createLedgerService({ db, FieldValue })
  return createRewardSettlementService({
    db,
    FieldValue,
    Timestamp,
    wallet,
    ledger,
    getEconomyConfig,
    ...(now ? { now } : {}),
    ...overrides,
  })
}

function buildVoteService({ now } = {}) {
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

async function seedStatus({ statusId, authorId, communityId = `c-${uid()}`, type = 'text' }) {
  await db.doc(`statuses/${statusId}`).set({
    communityId,
    authorId,
    type,
    text: 'oi',
    expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
  })
  return communityId
}

async function joinCommunity(communityId, userId) {
  await db.doc(`communityMembers/${communityId}_${userId}`).set({ communityId, userId })
}

// Semeia um voto econômico DIRETO no Firestore, pulando vote-service.js -- necessário
// pra controlar rewardPendingAt/rewardDayKey com precisão nos testes de ordem/limite.
async function seedPendingVote({ statusId, voterId, authorId, rewardDayKey, rewardPendingAtMs }) {
  await db.doc(`statuses/${statusId}/economyVotes/${voterId}`).set({
    userId: voterId,
    authorId,
    value: 1,
    charged: true,
    firstChargedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    rewardState: 'pending',
    rewardPendingAt: Timestamp.fromMillis(rewardPendingAtMs),
    rewardDayKey,
  })
}

async function seedDeferredVote({
  statusId,
  voterId,
  authorId,
  rewardDayKey,
  rewardPendingAtMs,
  rewardRetryAtMs,
}) {
  await db.doc(`statuses/${statusId}/economyVotes/${voterId}`).set({
    userId: voterId,
    authorId,
    value: 1,
    charged: true,
    firstChargedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    rewardState: 'deferred',
    rewardPendingAt: Timestamp.fromMillis(rewardPendingAtMs),
    rewardDayKey,
    rewardRetryAt: Timestamp.fromMillis(rewardRetryAtMs),
  })
}

async function getWallet(userId) {
  const snapshot = await db.doc(`users/${userId}/wallet/current`).get()
  return snapshot.exists ? snapshot.data() : null
}

async function getVote(statusId, voterId) {
  const snapshot = await db.doc(`statuses/${statusId}/economyVotes/${voterId}`).get()
  return snapshot.exists ? snapshot.data() : null
}

async function getAuthorDaily(userId, dateKey) {
  const snapshot = await db.doc(`users/${userId}/economyDaily/${dateKey}`).get()
  return snapshot.exists ? snapshot.data() : null
}

async function getPostRewardDaily(statusId, dateKey) {
  const snapshot = await db.doc(`statuses/${statusId}/economyRewardDaily/${dateKey}`).get()
  return snapshot.exists ? snapshot.data() : null
}

async function countLedgerEntries(userId) {
  const snapshot = await db.collection(`users/${userId}/economyTransactions`).get()
  return snapshot.size
}

const DAY = '2026-02-10'

test('um voto pending elegível é processado: credita o autor, grava ledger, atualiza contadores, marca o voto', async () => {
  const authorId = uid()
  const voterId = uid()
  const statusId = uid()
  await seedStatus({ statusId, authorId })
  await seedPendingVote({
    statusId,
    voterId,
    authorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T10:00:00-03:00`),
  })

  const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`) })
  const result = await settle()

  assert.equal(result.skipped, false)
  assert.equal(result.processed, 1)
  assert.equal(result.capped, 0)
  assert.equal(result.deferred, 0)

  const wallet = await getWallet(authorId)
  assert.equal(wallet.coinBalance, DEFAULT_ECONOMY_CONFIG.voting.rewardCoinsPerPositiveVote)

  const vote = await getVote(statusId, voterId)
  assert.equal(vote.rewardState, 'processed')
  assert.ok(vote.rewardSettledAt)

  const authorDaily = await getAuthorDaily(authorId, DAY)
  assert.equal(
    authorDaily.authorRewardCoins,
    DEFAULT_ECONOMY_CONFIG.voting.rewardCoinsPerPositiveVote
  )

  const postDaily = await getPostRewardDaily(statusId, DAY)
  assert.equal(postDaily.coinsCredited, DEFAULT_ECONOMY_CONFIG.voting.rewardCoinsPerPositiveVote)

  const voterDaily = await getAuthorDaily(voterId, DAY)
  assert.equal(voterDaily.rewardedVotesGiven, 1)
  assert.equal(voterDaily.authorRewardCounts[authorId], 1)

  assert.equal(await countLedgerEntries(authorId), 1)
})

test('vários votantes para o mesmo autor consolidam em UM único wallet/ledger, mas cada voto vira processed', async () => {
  const authorId = uid()
  const statusId = uid()
  await seedStatus({ statusId, authorId })
  const voterIds = [uid(), uid(), uid()]
  for (const [i, voterId] of voterIds.entries()) {
    await seedPendingVote({
      statusId,
      voterId,
      authorId,
      rewardDayKey: DAY,
      rewardPendingAtMs: Date.parse(`${DAY}T10:0${i}:00-03:00`),
    })
  }

  const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`) })
  const result = await settle()
  assert.equal(result.processed, 3)

  const wallet = await getWallet(authorId)
  assert.equal(wallet.coinBalance, 3 * DEFAULT_ECONOMY_CONFIG.voting.rewardCoinsPerPositiveVote)
  assert.equal(await countLedgerEntries(authorId), 1, 'consolidado -- 1 lançamento só, não 3')

  for (const voterId of voterIds) {
    assert.equal((await getVote(statusId, voterId)).rewardState, 'processed')
  }
})

test('limite por post/dia: o voto que estouraria é capped, os anteriores no mesmo post não', async () => {
  const authorId = uid()
  const statusId = uid()
  await seedStatus({ statusId, authorId })
  await db.doc('economyConfig/current').set({
    dailyActivity: DEFAULT_ECONOMY_CONFIG.dailyActivity,
    voting: {
      ...DEFAULT_ECONOMY_CONFIG.voting,
      maxRewardCoinsPerPostDay: 2,
      maxRewardCoinsPerAuthorDay: 1000,
    },
  })
  try {
    const voterIds = [uid(), uid(), uid()]
    for (const [i, voterId] of voterIds.entries()) {
      await seedPendingVote({
        statusId,
        voterId,
        authorId,
        rewardDayKey: DAY,
        rewardPendingAtMs: Date.parse(`${DAY}T10:0${i}:00-03:00`),
      })
    }
    const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`) })
    const result = await settle()
    assert.equal(result.processed, 2)
    assert.equal(result.capped, 1)
    const cappedVote = await getVote(statusId, voterIds[2])
    assert.equal(cappedVote.rewardState, 'capped')
    assert.equal(cappedVote.rewardCappedReason, 'post_daily_limit')
  } finally {
    await db.doc('economyConfig/current').delete()
  }
})

test('publicação removida antes do settlement: voto vira capped, sem crédito', async () => {
  const authorId = uid()
  const voterId = uid()
  const statusId = uid()
  await seedStatus({ statusId, authorId })
  await seedPendingVote({
    statusId,
    voterId,
    authorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T10:00:00-03:00`),
  })
  await db.doc(`statuses/${statusId}`).delete()

  const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`) })
  const result = await settle()
  assert.equal(result.capped, 1)
  const vote = await getVote(statusId, voterId)
  assert.equal(vote.rewardState, 'capped')
  assert.equal(vote.rewardCappedReason, 'status_gone')
  assert.equal(await getWallet(authorId), null)
})

test('voto econômico antigo pending de Treino Marcado é capped sem gerar crédito novo', async () => {
  const authorId = uid()
  const voterId = uid()
  const statusId = uid()
  await seedStatus({ statusId, authorId, type: 'workout' })
  await seedPendingVote({
    statusId,
    voterId,
    authorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T10:00:00-03:00`),
  })

  const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`) })
  const result = await settle()

  assert.equal(result.processed, 0)
  assert.equal(result.capped, 1)
  assert.equal(await getWallet(authorId), null)
  assert.equal(await countLedgerEntries(authorId), 0)
  assert.equal(await getAuthorDaily(authorId, DAY), null)
  assert.equal(await getPostRewardDaily(statusId, DAY), null)
  const vote = await getVote(statusId, voterId)
  assert.equal(vote.rewardState, 'capped')
  assert.equal(vote.rewardCappedReason, 'status_type_ineligible')
})

test('autor em exclusão: voto vira capped, sem crédito', async () => {
  const authorId = uid()
  const voterId = uid()
  const statusId = uid()
  await seedStatus({ statusId, authorId })
  await seedPendingVote({
    statusId,
    voterId,
    authorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T10:00:00-03:00`),
  })
  await db.doc(`deletionJobs/account_${authorId}`).set({ state: 'pending' })

  const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`) })
  const result = await settle()
  assert.equal(result.capped, 1)
  const vote = await getVote(statusId, voterId)
  assert.equal(vote.rewardCappedReason, 'author_deleted')
  assert.equal(await getWallet(authorId), null)
})

test('autor banido (system_ban): voto vira capped, sem crédito', async () => {
  const authorId = uid()
  const voterId = uid()
  const statusId = uid()
  await seedStatus({ statusId, authorId })
  await seedPendingVote({
    statusId,
    voterId,
    authorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T10:00:00-03:00`),
  })
  await db.doc(`accountRestrictions/${authorId}`).set({ action: 'system_ban' })

  const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`) })
  const result = await settle()
  assert.equal(result.capped, 1)
  assert.equal((await getVote(statusId, voterId)).rewardCappedReason, 'author_banned')
})

test('autor com suspensão temporária ativa: voto vira deferred (não capped), preserva rewardPendingAt, some da consulta principal', async () => {
  const authorId = uid()
  const voterId = uid()
  const statusId = uid()
  const pendingAtMs = Date.parse(`${DAY}T10:00:00-03:00`)
  const nowMs = Date.parse(`${DAY}T12:00:00-03:00`)
  await seedStatus({ statusId, authorId })
  await seedPendingVote({
    statusId,
    voterId,
    authorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: pendingAtMs,
  })
  await db.doc(`accountRestrictions/${authorId}`).set({
    action: 'temporary_suspension',
    until: Timestamp.fromMillis(nowMs + 60 * 60 * 1000),
  })

  const settle = buildSettlement({ now: () => nowMs })
  const result = await settle()
  assert.equal(result.deferred, 1)
  assert.equal(result.processed, 0)
  assert.equal(result.capped, 0)

  const vote = await getVote(statusId, voterId)
  assert.equal(vote.rewardState, 'deferred')
  assert.equal(vote.rewardPendingAt.toMillis(), pendingAtMs, 'evento elegível original preservado')
  assert.ok(vote.rewardRetryAt)

  // Rodar de novo: não deveria mais aparecer na consulta principal (não é mais pending).
  const secondRun = await settle()
  assert.equal(secondRun.discovered, 0)
})

// Nota de design: um post tem UM autor só, então "deferred por suspensão do autor" nunca
// pode ser uma característica de ALGUNS votos de um post e não de outros -- se o autor
// está suspenso, TODOS os votos daquele post ficam deferred juntos. O cenário real que
// precisa ser provado é diferente: um voto que uma execução ANTERIOR já deixou
// 'deferred' (portanto não é mais candidato nesta execução, nem existe mais na consulta
// de pending) não pode ter "reservado" nada do teto para um voto pending diferente no
// mesmo post/dia, processado agora.
test('deferred não reserva quota: um voto já deferred de execução anterior não conta contra o teto de um voto pending novo no mesmo post/dia', async () => {
  const authorId = uid()
  const statusId = uid()
  const deferredVoterId = uid()
  const pendingVoterId = uid()
  await seedStatus({ statusId, authorId })
  await db.doc('economyConfig/current').set({
    dailyActivity: DEFAULT_ECONOMY_CONFIG.dailyActivity,
    voting: {
      ...DEFAULT_ECONOMY_CONFIG.voting,
      maxRewardCoinsPerPostDay: 1,
      maxRewardCoinsPerAuthorDay: 1000,
    },
  })
  try {
    // Retry ainda não vencido -- não deveria ser promovido nesta execução, então
    // permanece fora da consulta de pending o tempo todo.
    await seedDeferredVote({
      statusId,
      voterId: deferredVoterId,
      authorId,
      rewardDayKey: DAY,
      rewardPendingAtMs: Date.parse(`${DAY}T09:00:00-03:00`),
      rewardRetryAtMs: Date.parse(`${DAY}T23:59:00-03:00`),
    })
    await seedPendingVote({
      statusId,
      voterId: pendingVoterId,
      authorId,
      rewardDayKey: DAY,
      rewardPendingAtMs: Date.parse(`${DAY}T10:00:00-03:00`),
    })
    const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`) })
    const result = await settle()
    assert.equal(result.promoted, 0, 'retryAt ainda não venceu -- não promovido nesta execução')
    assert.equal(result.processed, 1)
    assert.equal(
      result.deferred,
      0,
      'o voto já deferred não é candidato desta execução -- nem é tocado'
    )

    const pendingVote = await getVote(statusId, pendingVoterId)
    assert.equal(
      pendingVote.rewardState,
      'processed',
      'o voto deferred não reservou o teto do post -- este ainda coube inteiro'
    )
    const stillDeferred = await getVote(statusId, deferredVoterId)
    assert.equal(
      stillDeferred.rewardState,
      'deferred',
      'intocado -- não era candidato desta execução'
    )
  } finally {
    await db.doc('economyConfig/current').delete()
  }
})

test('head-of-line: votos antigos deferred não bloqueiam um voto mais novo de outro autor na mesma execução', async () => {
  const suspendedAuthorId = uid()
  const okAuthorId = uid()
  const voterId = uid()
  const oldStatusId = uid()
  const newStatusId = uid()
  await seedStatus({ statusId: oldStatusId, authorId: suspendedAuthorId })
  await seedStatus({ statusId: newStatusId, authorId: okAuthorId })
  const nowMs = Date.parse(`${DAY}T12:00:00-03:00`)
  await seedPendingVote({
    statusId: oldStatusId,
    voterId,
    authorId: suspendedAuthorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T08:00:00-03:00`), // mais antigo
  })
  await seedPendingVote({
    statusId: newStatusId,
    voterId,
    authorId: okAuthorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T09:00:00-03:00`), // mais novo, mas ainda antes de "agora"
  })
  await db.doc(`accountRestrictions/${suspendedAuthorId}`).set({
    action: 'temporary_suspension',
    until: Timestamp.fromMillis(nowMs + 60 * 60 * 1000),
  })

  const settle = buildSettlement({ now: () => nowMs })
  const result = await settle()
  assert.equal(result.deferred, 1)
  assert.equal(result.processed, 1)
  assert.equal((await getVote(newStatusId, voterId)).rewardState, 'processed')
})

test('RACE: deferred -> votante remove o voto -> promoção não pode ressuscitar pending', async () => {
  const authorId = uid()
  const voterId = uid()
  const statusId = uid()
  const pendingAtMs = Date.parse(`${DAY}T08:00:00-03:00`)
  const communityId = await seedStatus({ statusId, authorId })
  await joinCommunity(communityId, voterId)
  // Retry já vencido -- se a promoção não revalidasse, promoveria de volta a pending.
  await seedDeferredVote({
    statusId,
    voterId,
    authorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: pendingAtMs,
    rewardRetryAtMs: Date.parse(`${DAY}T09:00:00-03:00`),
  })

  // O votante muda de ideia ENQUANTO o voto está deferred -- vote-service.js já
  // transiciona isto para ineligible (ver vote-core.js: deferred não é terminal).
  const voteOnPost = buildVoteService()
  await voteOnPost(voterId, statusId, null) // remove
  let vote = await getVote(statusId, voterId)
  assert.equal(vote.rewardState, 'ineligible')

  // Agora a promoção roda (retryAt já passou) -- precisa reler e ver rewardState !==
  // 'deferred', descartando este voto em vez de promovê-lo de volta a pending.
  const settle = buildSettlement({ now: () => Date.parse(`${DAY}T10:00:00-03:00`) })
  const result = await settle()
  assert.equal(result.promoted, 0)

  vote = await getVote(statusId, voterId)
  assert.equal(vote.rewardState, 'ineligible', 'nunca deveria ter voltado a pending')
})

test('promoção: deferred com rewardRetryAt vencido volta a pending preservando rewardPendingAt, e é processado na mesma execução', async () => {
  const authorId = uid()
  const voterId = uid()
  const statusId = uid()
  const pendingAtMs = Date.parse(`${DAY}T08:00:00-03:00`)
  await seedStatus({ statusId, authorId })
  await seedDeferredVote({
    statusId,
    voterId,
    authorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: pendingAtMs,
    rewardRetryAtMs: Date.parse(`${DAY}T09:00:00-03:00`),
  })

  const settle = buildSettlement({ now: () => Date.parse(`${DAY}T10:00:00-03:00`) })
  const result = await settle()
  assert.equal(result.promoted, 1)
  assert.equal(
    result.processed,
    1,
    'promovido e processado na MESMA execução (promoção roda antes da descoberta)'
  )

  const vote = await getVote(statusId, voterId)
  assert.equal(vote.rewardState, 'processed')
  const wallet = await getWallet(authorId)
  assert.equal(wallet.coinBalance, DEFAULT_ECONOMY_CONFIG.voting.rewardCoinsPerPositiveVote)
})

test('ordem global entre autores é preservada mesmo atravessando limite de chunk (chunkSize pequeno)', async () => {
  const voterId = uid()
  const authors = [uid(), uid(), uid(), uid()]
  const statuses = authors.map(() => uid())
  for (const [i, authorId] of authors.entries()) {
    await seedStatus({ statusId: statuses[i], authorId })
  }
  // Ordem cronológica: authors[3] é o mais antigo, authors[1] o mais novo.
  const order = [3, 0, 2, 1]
  for (const [rank, authorIndex] of order.entries()) {
    await seedPendingVote({
      statusId: statuses[authorIndex],
      voterId,
      authorId: authors[authorIndex],
      rewardDayKey: DAY,
      rewardPendingAtMs: Date.parse(`${DAY}T0${rank}:00:00-03:00`),
    })
  }
  await db.doc('economyConfig/current').set({
    dailyActivity: DEFAULT_ECONOMY_CONFIG.dailyActivity,
    voting: { ...DEFAULT_ECONOMY_CONFIG.voting, maxRewardedVotesPerVoterDay: 3 },
  })
  try {
    // chunkSize=2: força os 4 votos em 2 transações separadas -- a ordem global só é
    // respeitada de verdade se a segunda transação enxergar o contador já incrementado
    // pela primeira.
    const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`), chunkSize: 2 })
    const result = await settle()
    assert.equal(result.processed, 3)
    assert.equal(result.capped, 1)

    // Os 3 mais antigos (na ordem cronológica: authors[3], authors[0], authors[2])
    // processam; o mais novo (authors[1], 4º na ordem) é capped -- nunca "o último dos
    // 2 primeiros chunks" nem qualquer critério que dependesse de reagrupar por autor.
    assert.equal((await getVote(statuses[3], voterId)).rewardState, 'processed')
    assert.equal((await getVote(statuses[0], voterId)).rewardState, 'processed')
    assert.equal((await getVote(statuses[2], voterId)).rewardState, 'processed')
    const lastVote = await getVote(statuses[1], voterId)
    assert.equal(lastVote.rewardState, 'capped')
    assert.equal(lastVote.rewardCappedReason, 'voter_daily_limit')
  } finally {
    await db.doc('economyConfig/current').delete()
  }
})

test('consolidação entre papéis: o mesmo uid como autor creditado E como votante no mesmo chunk grava um único documento com os dois campos', async () => {
  const dual = uid() // ao mesmo tempo autor de um voto e votante de outro
  const otherAuthor = uid()
  const otherVoter = uid()
  const statusOfDual = uid()
  const statusOfOtherAuthor = uid()
  await seedStatus({ statusId: statusOfDual, authorId: dual })
  await seedStatus({ statusId: statusOfOtherAuthor, authorId: otherAuthor })

  // otherVoter vota no post de "dual" (dual recebe crédito como autor).
  await seedPendingVote({
    statusId: statusOfDual,
    voterId: otherVoter,
    authorId: dual,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T09:00:00-03:00`),
  })
  // "dual" vota no post de outro autor (dual recebe incremento como votante).
  await seedPendingVote({
    statusId: statusOfOtherAuthor,
    voterId: dual,
    authorId: otherAuthor,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T09:01:00-03:00`),
  })

  const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`) })
  const result = await settle()
  assert.equal(result.processed, 2)

  const dualDaily = await getAuthorDaily(dual, DAY)
  assert.equal(
    dualDaily.authorRewardCoins,
    DEFAULT_ECONOMY_CONFIG.voting.rewardCoinsPerPositiveVote,
    'papel de autor -- nunca perdido pela escrita do papel de votante'
  )
  assert.equal(
    dualDaily.rewardedVotesGiven,
    1,
    'papel de votante -- nunca perdido pela escrita do papel de autor'
  )
  assert.equal(dualDaily.authorRewardCounts[otherAuthor], 1)
})

test('revalidação no reread: um voto que mudou de valor entre a descoberta e o commit é ignorado, não creditado', async () => {
  const authorId = uid()
  const voterId = uid()
  const statusId = uid()
  await seedStatus({ statusId, authorId })
  await seedPendingVote({
    statusId,
    voterId,
    authorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T10:00:00-03:00`),
  })

  // Simula uma corrida: o votante muda de ideia depois que este teste "descobriria" o
  // voto, mas antes do settlement de fato rodar -- vote-service.js real faria isto,
  // aqui simulamos a gravação direta pra não depender de timing real entre dois processos.
  await db
    .doc(`statuses/${statusId}/economyVotes/${voterId}`)
    .set({ value: -1, rewardState: 'ineligible' }, { merge: true })

  const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`) })
  const result = await settle()
  assert.equal(result.processed, 0)
  assert.equal(result.capped, 0)
  assert.equal(await getWallet(authorId), null)
})

// Lease já ativo (simulando uma execução em andamento) é o caso DETERMINÍSTICO: sem
// nenhuma corrida real envolvida, a nova execução sempre encontra o lease válido já na
// primeira tentativa e encerra sem tocar em nada.
test('lease: uma execução já em andamento (lease ativo) faz a nova execução encerrar sem processar nada', async () => {
  const authorId = uid()
  const voterId = uid()
  const statusId = uid()
  await seedStatus({ statusId, authorId })
  await seedPendingVote({
    statusId,
    voterId,
    authorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T10:00:00-03:00`),
  })

  const nowMs = Date.parse(`${DAY}T12:00:00-03:00`)
  await db.doc('maintenance/rewardSettlementLock').set({
    leaseToken: 'outra-execucao-em-andamento',
    leaseUntil: Timestamp.fromMillis(nowMs + 60 * 1000),
  })

  try {
    const settle = buildSettlement({ now: () => nowMs })
    const result = await settle()
    assert.equal(result.skipped, true)
    assert.equal(result.reason, 'lease_held')
    assert.equal(await getWallet(authorId), null, 'nada deveria ter sido processado')
    assert.equal((await getVote(statusId, voterId)).rewardState, 'pending', 'intocado')
  } finally {
    // Este lease simulado nunca é liberado por settleVoteRewards (a execução nem
    // chegou a rodar) -- sem isto, ficaria "ativo" (leaseUntil no futuro) para
    // qualquer teste seguinte que reutilize o mesmo "now" congelado.
    await db.doc('maintenance/rewardSettlementLock').set({ leaseUntil: Timestamp.fromMillis(0) })
    // O voto deste teste fica DE PROPÓSITO 'pending' (nada foi processado) -- mas a
    // descoberta de QUALQUER teste seguinte é uma collection-group query GLOBAL, sem
    // escopo por teste. Sem limpar, este voto vazaria para a consulta do próximo teste
    // que rodar settle(), inflando result.processed/discovered ali.
    await db.doc(`statuses/${statusId}/economyVotes/${voterId}`).delete()
  }
})

// Política de lease (auditoria operacional, seção 1): a garantia contra "duas
// execuções válidas simultâneas por expiração prematura" é ESTRUTURAL, não uma
// esperança -- a duração do lease é derivada do timeoutSeconds real da function
// agendada (ver reward-settlement-service.js), nunca um número independente que possa
// divergir por engano. Bug real encontrado e corrigido nesta auditoria: o valor
// anterior (4min) era MENOR que os 300s (5min) de timeoutSeconds.
test('política de lease: a duração padrão excede o timeoutSeconds real da function agendada, com margem de segurança', () => {
  assert.ok(
    LEASE_DURATION_MS > SETTLEMENT_FUNCTION_TIMEOUT_SECONDS * 1000,
    'o lease precisa durar mais que o tempo máximo de execução permitido, nunca menos'
  )
})

test('lease: uma execução antiga não pode liberar o lease que outra execução já adquiriu depois que o dela expirou', async () => {
  let nowMs = Date.parse(`${DAY}T12:00:00-03:00`)
  // leaseDurationMs bem curto de propósito, só para o teste poder simular a expiração
  // sem esperar os minutos reais -- a garantia testada (token comparado antes de
  // liberar) não depende do valor real de produção.
  const settle = buildSettlement({ now: () => nowMs, leaseDurationMs: 1000 })
  try {
    // A adquire lease.
    const tokenA = await settle.acquireLease()
    assert.ok(tokenA)

    // lease antigo (de A) expira.
    nowMs += 2000

    // B adquire novo lease.
    const tokenB = await settle.acquireLease()
    assert.ok(tokenB)
    assert.notEqual(tokenB, tokenA)

    // A tenta liberar (com o próprio token, já vencido e não mais dono do documento).
    await settle.releaseLease(tokenA)

    // -> lease de B permanece intacto -- releaseLease só apaga o PRÓPRIO leaseToken,
    // nunca o de quem assumiu depois dele expirar.
    const lock = await db.doc('maintenance/rewardSettlementLock').get()
    assert.equal(lock.data().leaseToken, tokenB)
    assert.ok(lock.data().leaseUntil.toMillis() > nowMs, 'não foi zerado pela tentativa de A')

    await settle.releaseLease(tokenB)
  } finally {
    await db.doc('maintenance/rewardSettlementLock').set({ leaseUntil: Timestamp.fromMillis(0) })
  }
})

// CONCORRÊNCIA real via Promise.all: duas chamadas a settleVoteRewards() disputando o
// MESMO lease ao mesmo tempo. A garantia que realmente importa aqui não é "a segunda
// sempre recebe skipped:true na hora" -- o SDK do Firestore reexecuta uma transação em
// conflito automaticamente, então a "perdedora" pode legitimamente reobter o lease
// DEPOIS que a vencedora já liberou (ver teste acima para o caso sem essa ambiguidade
// de tempo) -- a garantia é que a escrita de crédito NUNCA acontece duas vezes, não
// importa qual das duas sequências (rejeição imediata ou nova tentativa serializada)
// o SDK escolher.
test('CONCORRÊNCIA: duas execuções do scheduler disputando o mesmo lease nunca produzem crédito duplicado', async () => {
  const authorId = uid()
  const voterId = uid()
  const statusId = uid()
  await seedStatus({ statusId, authorId })
  await seedPendingVote({
    statusId,
    voterId,
    authorId,
    rewardDayKey: DAY,
    rewardPendingAtMs: Date.parse(`${DAY}T10:00:00-03:00`),
  })

  const settle = buildSettlement({ now: () => Date.parse(`${DAY}T12:00:00-03:00`) })
  const [resultA, resultB] = await Promise.all([settle(), settle()])

  // As duas nunca podem ter processado o MESMO voto -- ou uma delas nem viu nada
  // pendente (a outra já tinha processado), ou uma foi rejeitada de cara pelo lease.
  const totalProcessed = [resultA, resultB]
    .filter((r) => !r.skipped)
    .reduce((sum, r) => sum + r.processed, 0)
  assert.equal(
    totalProcessed,
    1,
    'o voto único só pode ter sido processado por uma das duas execuções'
  )

  const wallet = await getWallet(authorId)
  assert.equal(
    wallet.coinBalance,
    DEFAULT_ECONOMY_CONFIG.voting.rewardCoinsPerPositiveVote,
    'crédito único, não duplicado'
  )
  assert.equal(await countLedgerEntries(authorId), 1)
  assert.equal((await getVote(statusId, voterId)).rewardState, 'processed')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createConfigService } from './config-service.js'
import { createWalletService } from './wallet-service.js'
import { createLedgerService } from './ledger-service.js'
import { createActivityService, todayKey } from './activity-service.js'

// Admin SDK direto contra o emulador, mesmo padrão de rate-limit-service.test.js: esta
// lógica roda dentro de uma Cloud Function callable (Admin SDK, ignora firestore.rules),
// então testar contra as rules aqui não faria sentido -- isso é coberto à parte em
// tests/economy-rules.test.mjs.
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
initializeApp({ projectId: 'demo-treinos-functions-test' })
const db = getFirestore()

let counter = 0
function uid() {
  return `activity-user-${Date.now()}-${counter++}`
}

// assertWritableAccount real (ver functions/index.js) sem reimportar o módulo inteiro
// (que carregaria manifestos legais e outras dependências irrelevantes a este teste).
async function assertWritableAccount(tx, testUid) {
  if ((await tx.get(db.doc(`deletionJobs/account_${testUid}`))).exists) {
    throw new Error('A conta está em exclusão.')
  }
}

function buildService({ now } = {}) {
  // log silencioso: este teste roda sem economyConfig/current de propósito (valida os
  // defaults embutidos), então o warning de "config ausente" é esperado, não um problema.
  const getEconomyConfig = createConfigService({ db, log: { warn: () => {} } })
  const wallet = createWalletService({ db, FieldValue })
  const ledger = createLedgerService({ db, FieldValue })
  return createActivityService({
    db,
    FieldValue,
    wallet,
    ledger,
    getEconomyConfig,
    assertWritableAccount,
    ...(now ? { now } : {}),
  })
}

async function getWallet(testUid) {
  const snapshot = await db.doc(`users/${testUid}/wallet/current`).get()
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

test('wallet inicial: nenhum documento existe antes da primeira atividade', async () => {
  const testUid = uid()
  assert.equal(await getWallet(testUid), null)
})

test('primeiro checkpoint do dia nunca credita (sem checkpoint anterior pra medir intervalo)', async () => {
  const testUid = uid()
  const start = Date.parse('2026-01-10T12:00:00-03:00')
  const registerQualifiedActivity = buildService({ now: () => start })
  const result = await registerQualifiedActivity(testUid)
  assert.equal(result.granted, false)
  assert.equal(await getWallet(testUid), null)
  const daily = await getDaily(testUid, todayKey(start))
  assert.equal(daily.activeMinutes, 0)
  assert.equal(daily.checkpointsCount, 1)
})

// Regressão: economyDaily/{date} passou a ser compartilhado com vote-service.js
// (votesCharged/voteCoinsSpent, ver Fase 2). Um tx.set() sem {merge:true} aqui
// apagaria silenciosamente esses contadores sempre que um checkpoint de atividade
// rodasse no mesmo dia -- exatamente o bug que a correção em activity-service.js evita.
test('um checkpoint de atividade nunca apaga votesCharged/voteCoinsSpent já gravados no mesmo dia', async () => {
  const testUid = uid()
  const start = Date.parse('2026-01-16T09:00:00-03:00')
  const dateKey = todayKey(start)
  await db.doc(`users/${testUid}/economyDaily/${dateKey}`).set({
    votesCharged: 5,
    voteCoinsSpent: 15,
  })
  const registerQualifiedActivity = buildService({ now: () => start })
  await registerQualifiedActivity(testUid)
  const daily = await getDaily(testUid, dateKey)
  assert.equal(daily.votesCharged, 5)
  assert.equal(daily.voteCoinsSpent, 15)
  assert.equal(daily.checkpointsCount, 1)
})

// Nome anterior ("dois checkpoints reais... creditam 3 EvoCoins") podia sugerir 2
// chamadas totais, o que contradiria o próprio teto por intervalo (20min): com a base
// (0min, sem checkpoint anterior pra medir) + no máximo 20min por intervalo, são sempre
// necessárias PELO MENOS 3 chamadas totais pra alcançar 30min. Este teste sempre fez as
// 3 chamadas abaixo -- "dois checkpoints reais" se refere aos dois que de fato somam
// minutos (15min + 16min), depois do checkpoint-base que só ancora o relógio.
test('reward diário: checkpoint-base + dois checkpoints reais (15min, 16min) cruzam 30min na 3ª chamada total e creditam 3 EvoCoins', async () => {
  const testUid = uid()
  let clock = Date.parse('2026-01-11T09:00:00-03:00')
  const registerQualifiedActivity = buildService({ now: () => clock })

  const base = await registerQualifiedActivity(testUid) // checkpoint-base: 0min, nunca credita
  assert.equal(base.granted, false)
  clock += 15 * 60 * 1000
  const second = await registerQualifiedActivity(testUid) // 1º checkpoint real: +15min (15 total)
  assert.equal(second.granted, false)
  clock += 16 * 60 * 1000
  const result = await registerQualifiedActivity(testUid) // 2º checkpoint real: +16min (31 total) -> cruza 30min

  assert.equal(result.granted, true)
  assert.equal(result.rewardCoins, 3)
  const wallet = await getWallet(testUid)
  assert.equal(wallet.coinBalance, 3)
  assert.equal(wallet.lifetimeCoinsEarned, 3)
  assert.equal(wallet.cashBalance, 0)
  assert.equal(await countLedgerEntries(testUid), 1)
})

test('reward duplicado: chamadas depois do reward do dia nunca creditam de novo (idempotência)', async () => {
  const testUid = uid()
  let clock = Date.parse('2026-01-12T09:00:00-03:00')
  const registerQualifiedActivity = buildService({ now: () => clock })

  await registerQualifiedActivity(testUid)
  clock += 16 * 60 * 1000
  await registerQualifiedActivity(testUid)
  clock += 16 * 60 * 1000
  const first = await registerQualifiedActivity(testUid)
  assert.equal(first.granted, true)

  clock += 60 * 60 * 1000
  const second = await registerQualifiedActivity(testUid)
  assert.equal(second.granted, false)
  assert.equal(second.reason, 'already_granted')

  const wallet = await getWallet(testUid)
  assert.equal(wallet.coinBalance, 3)
  assert.equal(await countLedgerEntries(testUid), 1)
})

test('checkpoint repetido cedo demais (duplo clique/retry) é ignorado sem alterar o estado', async () => {
  const testUid = uid()
  const start = Date.parse('2026-01-13T09:00:00-03:00')
  const registerQualifiedActivity = buildService({ now: () => start })

  await registerQualifiedActivity(testUid)
  const dailyBefore = await getDaily(testUid, todayKey(start))

  // Retry imediato, mesmo "agora" -- gap zero, bem abaixo do mínimo.
  const retry = await registerQualifiedActivity(testUid)
  assert.equal(retry.granted, false)
  assert.equal(retry.reason, 'too_soon')

  const dailyAfter = await getDaily(testUid, todayKey(start))
  assert.deepEqual(dailyAfter, dailyBefore)
})

test('checkpoints rejeitados (too_soon) nunca consomem o limite diário de checkpoints', async () => {
  const testUid = uid()
  const start = Date.parse('2026-01-13T10:00:00-03:00')
  const registerQualifiedActivity = buildService({ now: () => start })

  // 1 checkpoint válido, seguido de 20 tentativas com o mesmo "agora" -- todas caem em
  // too_soon (gap zero) e não deveriam incrementar checkpointsCount nem gastar nada do
  // teto de MAX_CHECKPOINTS_PER_DAY (6).
  await registerQualifiedActivity(testUid)
  for (let i = 0; i < 20; i++) {
    const retry = await registerQualifiedActivity(testUid)
    assert.equal(retry.granted, false)
    assert.equal(retry.reason, 'too_soon')
  }
  const daily = await getDaily(testUid, todayKey(start))
  assert.equal(daily.checkpointsCount, 1)
})

test('requisições simultâneas ao redor do limiar creditam o reward uma única vez', async () => {
  const testUid = uid()
  let clock = Date.parse('2026-01-14T09:00:00-03:00')
  const registerQualifiedActivity = buildService({ now: () => clock })

  await registerQualifiedActivity(testUid)
  clock += 16 * 60 * 1000
  await registerQualifiedActivity(testUid)
  clock += 16 * 60 * 1000

  // Cinco chamadas concorrentes com o mesmo "agora" (32 min acumulados, acima do
  // limiar) -- a transação do Firestore serializa a contenção; só a primeira a
  // commitar cruza o limiar, e todas as outras releem lastQualifiedActivityAt já igual
  // ao próprio "agora" (gap zero, "too_soon").
  const results = await Promise.all(
    Array.from({ length: 5 }, () => registerQualifiedActivity(testUid))
  )
  const grantedCount = results.filter((r) => r.granted).length
  assert.equal(grantedCount, 1)

  const wallet = await getWallet(testUid)
  assert.equal(wallet.coinBalance, 3)
  assert.equal(await countLedgerEntries(testUid), 1)
})

test('conta em exclusão nunca ganha recompensa (assertWritableAccount)', async () => {
  const testUid = uid()
  await db.doc(`deletionJobs/account_${testUid}`).set({ state: 'pending' })
  const registerQualifiedActivity = buildService()
  await assert.rejects(() => registerQualifiedActivity(testUid))
  assert.equal(await getWallet(testUid), null)
})

// Ponta a ponta (não só a unidade em config-service.test.js): prova que um
// economyConfig/current existente mas malformado nunca chega a creditar um valor
// absurdo. Sem a validação em config-service.js, requiredMinutes negativo tornaria o
// PRÓPRIO checkpoint-base (0 minutos acumulados, o primeiro de todos) já "elegível"
// (0 >= -5), creditando rewardCoins mesmo sem nenhuma atividade real medida.
test('economyConfig/current malformado (requiredMinutes negativo, rewardCoins absurdo) nunca credita -- cai para os defaults de sanidade', async () => {
  const testUid = uid()
  await db.doc('economyConfig/current').set({
    dailyActivity: { requiredMinutes: -5, rewardCoins: 999999999 },
  })
  try {
    const start = Date.parse('2026-01-15T09:00:00-03:00')
    const registerQualifiedActivity = buildService({ now: () => start })
    const result = await registerQualifiedActivity(testUid)
    assert.equal(
      result.granted,
      false,
      'checkpoint-base (0min) nunca deveria creditar, mesmo com requiredMinutes negativo no documento'
    )
    assert.equal(
      await getWallet(testUid),
      null,
      'a carteira nunca deveria ter sido criada/creditada a partir de um config malformado'
    )
  } finally {
    await db.doc('economyConfig/current').delete()
  }
})

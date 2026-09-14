import { test } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createEnforcePostRateLimit, RATE_LIMIT_WINDOW_MS } from './rate-limit-service.js'

// Admin SDK direto contra o emulador (não @firebase/rules-unit-testing): esta lógica roda
// dentro de um gatilho, com Admin SDK, que ignora firestore.rules -- é exatamente por isso
// que ela existe (ver rate-limit-service.js: um get()/exists() extra nas regras reproduz o
// teto de chamadas por avaliação, confirmado antes desta versão).
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
initializeApp({ projectId: 'demo-treinos-functions-test' })
const db = getFirestore()

let counter = 0
function uid() {
  return `author-${Date.now()}-${counter++}`
}

async function getRestriction(authorId) {
  const snap = await db.doc(`accountRestrictions/${authorId}`).get()
  return snap.exists ? snap.data() : null
}

test('a legitimate burst at or under the threshold (8 in 10min) is never restricted', async () => {
  const enforcePostRateLimit = createEnforcePostRateLimit({
    db,
    FieldValue,
    Timestamp,
    enforce: true,
  })
  const authorId = uid()
  const start = Date.now()
  // Cross-postando a mesma atualização em 8 comunidades diferentes, rápido -- o cenário
  // de falso positivo que a decisão #2 deste item pediu pra testar explicitamente.
  for (let i = 0; i < 8; i++) {
    await enforcePostRateLimit(authorId, start + i * 1000)
  }
  assert.equal(await getRestriction(authorId), null)
})

test('the 9th post within the window crosses the threshold and gets restricted (enforce: true)', async () => {
  const enforcePostRateLimit = createEnforcePostRateLimit({
    db,
    FieldValue,
    Timestamp,
    enforce: true,
  })
  const authorId = uid()
  const start = Date.now()
  for (let i = 0; i < 9; i++) {
    await enforcePostRateLimit(authorId, start + i * 1000)
  }
  const restriction = await getRestriction(authorId)
  assert.ok(restriction, 'deveria ter criado accountRestrictions')
  assert.equal(restriction.action, 'temporary_suspension')
  assert.ok(restriction.decisionId)

  // As três peças precisam existir juntas -- é o ponto central desta investigação: uma
  // restrição sem moderationDecisions/notice bloquearia a conta de forma muda, sem
  // recurso (ver Support.jsx: o botão "Recorrer desta decisão" só aparece a partir do
  // notice, e submitSupportRequest(kind:'appeal') valida contra moderationDecisions).
  const decision = await db.doc(`moderationDecisions/${restriction.decisionId}`).get()
  assert.ok(decision.exists, 'deveria ter criado moderationDecisions')
  assert.equal(decision.data().automated, true)
  assert.equal(decision.data().adminId, 'system')
  assert.equal(decision.data().targetUserId, authorId)

  const notice = await db.doc(`users/${authorId}/notices/${restriction.decisionId}`).get()
  assert.ok(notice.exists, 'deveria ter criado o notice em /atendimento')
})

test('log-only mode (enforce: false) never writes the restriction, even past the threshold', async () => {
  const enforcePostRateLimit = createEnforcePostRateLimit({
    db,
    FieldValue,
    Timestamp,
    enforce: false,
  })
  const authorId = uid()
  const start = Date.now()
  for (let i = 0; i < 12; i++) {
    await enforcePostRateLimit(authorId, start + i * 1000)
  }
  assert.equal(await getRestriction(authorId), null)
  const decisions = await db
    .collection('moderationDecisions')
    .where('targetUserId', '==', authorId)
    .get()
  assert.equal(decisions.size, 0)
})

test('posts spread across separate windows never accumulate toward the threshold', async () => {
  const enforcePostRateLimit = createEnforcePostRateLimit({
    db,
    FieldValue,
    Timestamp,
    enforce: true,
  })
  const authorId = uid()
  const start = Date.now()
  for (let i = 0; i < 5; i++) {
    await enforcePostRateLimit(authorId, start + i * 1000)
  }
  // Fora da janela de 10min da primeira rajada -- não deveria somar com ela.
  const secondBurstStart = start + RATE_LIMIT_WINDOW_MS + 60000
  for (let i = 0; i < 5; i++) {
    await enforcePostRateLimit(authorId, secondBurstStart + i * 1000)
  }
  assert.equal(await getRestriction(authorId), null)
})

test('a post with no authorId is ignored', async () => {
  const enforcePostRateLimit = createEnforcePostRateLimit({
    db,
    FieldValue,
    Timestamp,
    enforce: true,
  })
  await assert.doesNotReject(() => enforcePostRateLimit(undefined))
  await assert.doesNotReject(() => enforcePostRateLimit(null))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateAuthorEligibility,
  planSettlementBatch,
  rewardSettlementNaturalKey,
} from './reward-settlement-core.js'

const LIMITS = {
  rewardCoinsPerPositiveVote: 1,
  maxRewardCoinsPerPostDay: 3,
  maxRewardCoinsPerAuthorDay: 5,
  maxRewardedVotesSameAuthorPerVoterDay: 2,
  maxRewardedVotesPerVoterDay: 3,
}

function vote({ voteKey, authorId, voterId, statusId = 's', rewardDayKey = '2026-02-01', eligible = true }) {
  return {
    voteKey,
    authorId,
    voterId,
    statusId,
    rewardDayKey,
    statusEligible: true,
    authorEligibility: eligible ? { status: 'eligible' } : { status: 'permanently_ineligible', reason: 'x' },
  }
}

// ---- evaluateAuthorEligibility ----

test('deletionJobExists always wins -- permanently_ineligible regardless of restriction', () => {
  const result = evaluateAuthorEligibility({ deletionJobExists: true, restriction: null, nowMs: 1000 })
  assert.equal(result.status, 'permanently_ineligible')
  assert.equal(result.reason, 'author_deleted')
})

test('system_ban -> permanently_ineligible', () => {
  const result = evaluateAuthorEligibility({
    deletionJobExists: false,
    restriction: { action: 'system_ban' },
    nowMs: 1000,
  })
  assert.equal(result.status, 'permanently_ineligible')
  assert.equal(result.reason, 'author_banned')
})

test('active temporary_suspension -> temporarily_ineligible with retryAt', () => {
  const result = evaluateAuthorEligibility({
    deletionJobExists: false,
    restriction: { action: 'temporary_suspension', until: { toMillis: () => 5000 } },
    nowMs: 1000,
  })
  assert.equal(result.status, 'temporarily_ineligible')
  assert.equal(result.retryAt, 5000)
})

test('expired temporary_suspension -> eligible', () => {
  const result = evaluateAuthorEligibility({
    deletionJobExists: false,
    restriction: { action: 'temporary_suspension', until: { toMillis: () => 500 } },
    nowMs: 1000,
  })
  assert.equal(result.status, 'eligible')
})

test('no restriction, no deletion job -> eligible', () => {
  assert.equal(
    evaluateAuthorEligibility({ deletionJobExists: false, restriction: null, nowMs: 1000 }).status,
    'eligible'
  )
})

test('community-level restrictions are never considered here -- out of scope by design', () => {
  // Só accountRestrictions entra na função; um objeto de restrição de comunidade
  // passado por engano (sem "action" reconhecido) nunca derruba a elegibilidade.
  const result = evaluateAuthorEligibility({
    deletionJobExists: false,
    restriction: { communityId: 'c1', userId: 'x' },
    nowMs: 1000,
  })
  assert.equal(result.status, 'eligible')
})

// ---- planSettlementBatch: caminho feliz ----

test('a single eligible vote under every limit is processed and credits the author', () => {
  const plan = planSettlementBatch({
    votes: [vote({ voteKey: 's:v1', authorId: 'a1', voterId: 'v1' })],
    initialCounters: {},
    limits: LIMITS,
  })
  assert.deepEqual(plan.outcomes, [{ voteKey: 's:v1', outcome: 'processed' }])
  assert.deepEqual(plan.authorCredits, { a1: { amount: 1, voteKeys: ['s:v1'] } })
  assert.deepEqual(plan.postDeltas, { 's|2026-02-01': 1 })
  assert.deepEqual(plan.authorDeltas, { 'a1|2026-02-01': 1 })
  assert.deepEqual(plan.voterAuthorDeltas, { 'v1|2026-02-01|a1': 1 })
  assert.deepEqual(plan.voterDeltas, { 'v1|2026-02-01': 1 })
})

test('multiple voters crediting the same author consolidate into one authorCredits entry', () => {
  const plan = planSettlementBatch({
    votes: [
      vote({ voteKey: 's:v1', authorId: 'a1', voterId: 'v1' }),
      vote({ voteKey: 's:v2', authorId: 'a1', voterId: 'v2' }),
    ],
    initialCounters: {},
    limits: LIMITS,
  })
  assert.deepEqual(plan.authorCredits.a1, { amount: 2, voteKeys: ['s:v1', 's:v2'] })
})

// ---- status/author ineligibility ----

test('a vote whose status no longer exists is capped, touches no counters', () => {
  const plan = planSettlementBatch({
    votes: [{ ...vote({ voteKey: 'k', authorId: 'a1', voterId: 'v1' }), statusEligible: false }],
    initialCounters: {},
    limits: LIMITS,
  })
  assert.deepEqual(plan.outcomes, [{ voteKey: 'k', outcome: 'capped', reason: 'status_gone' }])
  assert.deepEqual(plan.authorCredits, {})
})

test('a permanently ineligible author (deleted/banned) is capped, touches no counters', () => {
  const plan = planSettlementBatch({
    votes: [vote({ voteKey: 'k', authorId: 'a1', voterId: 'v1', eligible: false })],
    initialCounters: {},
    limits: LIMITS,
  })
  assert.deepEqual(plan.outcomes, [{ voteKey: 'k', outcome: 'capped', reason: 'x' }])
  assert.deepEqual(plan.authorCredits, {})
})

test('a temporarily suspended author defers the vote, touches no counters (no reserved quota)', () => {
  const plan = planSettlementBatch({
    votes: [
      {
        ...vote({ voteKey: 'k', authorId: 'a1', voterId: 'v1' }),
        authorEligibility: { status: 'temporarily_ineligible', reason: 'author_suspended', retryAt: 999 },
      },
    ],
    initialCounters: {},
    limits: LIMITS,
  })
  assert.deepEqual(plan.outcomes, [
    { voteKey: 'k', outcome: 'deferred', reason: 'author_suspended', retryAt: 999 },
  ])
  assert.deepEqual(plan.authorCredits, {})
  assert.deepEqual(plan.postDeltas, {})
  assert.deepEqual(plan.voterDeltas, {})
})

// ---- os 4 limites, cada um isoladamente ----

test('post daily cap: the vote that would cross it is capped, earlier ones in the same post are not', () => {
  // maxRewardCoinsPerPostDay = 3, rewardCoinsPerPositiveVote = 1 -- 3 votantes
  // diferentes cabem, o 4º (mesmo post, mesmo dia) estoura.
  const votes = ['v1', 'v2', 'v3', 'v4'].map((voterId) =>
    vote({ voteKey: `s:${voterId}`, authorId: 'a1', voterId, statusId: 's' })
  )
  const plan = planSettlementBatch({ votes, initialCounters: {}, limits: { ...LIMITS, maxRewardCoinsPerAuthorDay: 100 } })
  assert.deepEqual(
    plan.outcomes.map((o) => o.outcome),
    ['processed', 'processed', 'processed', 'capped']
  )
  assert.equal(plan.outcomes[3].reason, 'post_daily_limit')
})

test('author daily cap: spread across different posts, still caps once the author total is reached', () => {
  const votes = ['s1', 's2', 's3', 's4', 's5', 's6'].map((statusId, i) =>
    vote({ voteKey: `${statusId}:v${i}`, authorId: 'a1', voterId: `v${i}`, statusId })
  )
  // maxRewardCoinsPerAuthorDay = 5, cada voto vale 1 -- os 5 primeiros cabem, o 6º não.
  const plan = planSettlementBatch({ votes, initialCounters: {}, limits: LIMITS })
  assert.deepEqual(
    plan.outcomes.map((o) => o.outcome),
    ['processed', 'processed', 'processed', 'processed', 'processed', 'capped']
  )
  assert.equal(plan.outcomes[5].reason, 'author_daily_limit')
})

test('voter-author pair cap: the same voter rewarding the same author repeatedly (different posts) caps after the pair limit', () => {
  // maxRewardedVotesSameAuthorPerVoterDay = 2 -- v1 votando em 3 posts diferentes do
  // MESMO autor: os 2 primeiros contam, o 3º estoura o par (mesmo o post/autor globais
  // ainda tendo espaço).
  const votes = ['s1', 's2', 's3'].map((statusId) =>
    vote({ voteKey: `${statusId}:v1`, authorId: 'a1', voterId: 'v1', statusId })
  )
  const plan = planSettlementBatch({ votes, initialCounters: {}, limits: LIMITS })
  assert.deepEqual(
    plan.outcomes.map((o) => o.outcome),
    ['processed', 'processed', 'capped']
  )
  assert.equal(plan.outcomes[2].reason, 'voter_author_daily_limit')
})

test('voter aggregate cap (across DIFFERENT authors) caps after the voter total, even under every other limit', () => {
  // maxRewardedVotesPerVoterDay = 3 -- v1 votando em 4 autores diferentes (1 post cada,
  // nenhum outro limite chega perto de estourar): os 3 primeiros contam, o 4º estoura o
  // agregado do votante mesmo sendo autores/posts todos distintos.
  const votes = ['a1', 'a2', 'a3', 'a4'].map((authorId, i) =>
    vote({ voteKey: `s${i}:v1`, authorId, voterId: 'v1', statusId: `s${i}` })
  )
  const plan = planSettlementBatch({ votes, initialCounters: {}, limits: LIMITS })
  assert.deepEqual(
    plan.outcomes.map((o) => o.outcome),
    ['processed', 'processed', 'processed', 'capped']
  )
  assert.equal(plan.outcomes[3].reason, 'voter_daily_limit')
})

// ---- ORDEM GLOBAL preservada entre autores (o ponto central da auditoria) ----

test('cross-author ordering: the OLDEST event consumes the voter aggregate cap first, never reorganized by author', () => {
  // v1 tem 4 votos elegíveis para 4 autores diferentes, na ordem cronológica A1,A2,A3,A4
  // (índice 0 = mais antigo). maxRewardedVotesPerVoterDay = 3. Se o processamento
  // reagrupasse por autor antes de decidir, a ordem entre autores poderia mudar; aqui a
  // lista já chega ordenada e a função NUNCA reordena -- os 3 primeiros da lista (não
  // "os 3 primeiros por autor") são os que ganham.
  const votes = [
    vote({ voteKey: 's-A4:v1', authorId: 'A4', voterId: 'v1', statusId: 's-A4' }),
    vote({ voteKey: 's-A1:v1', authorId: 'A1', voterId: 'v1', statusId: 's-A1' }),
    vote({ voteKey: 's-A3:v1', authorId: 'A3', voterId: 'v1', statusId: 's-A3' }),
    vote({ voteKey: 's-A2:v1', authorId: 'A2', voterId: 'v1', statusId: 's-A2' }),
  ]
  // A ordem da LISTA (não dos nomes) é o que importa: A4 (mais antigo), A1, A3, A2 (mais novo).
  const plan = planSettlementBatch({ votes, initialCounters: {}, limits: LIMITS })
  assert.deepEqual(
    plan.outcomes.map((o) => o.voteKey),
    ['s-A4:v1', 's-A1:v1', 's-A3:v1', 's-A2:v1']
  )
  assert.deepEqual(
    plan.outcomes.map((o) => o.outcome),
    ['processed', 'processed', 'processed', 'capped']
  )
  // O autor que ficou de fora é o da posição 4 na ORDEM DA LISTA (A2), não "o último em
  // ordem alfabética" nem qualquer outro critério que um reagrupamento por autor
  // poderia introduzir.
  assert.equal(plan.outcomes[3].voteKey, 's-A2:v1')
})

// ---- contadores já persistidos (initialCounters) são respeitados, não só os do lote ----

test('initialCounters from a previous run/chunk are honored -- caps do not restart at zero every batch', () => {
  const plan = planSettlementBatch({
    votes: [vote({ voteKey: 's:v1', authorId: 'a1', voterId: 'v1' })],
    initialCounters: { postDaily: { 's|2026-02-01': 3 } }, // já no teto (maxRewardCoinsPerPostDay=3)
    limits: LIMITS,
  })
  assert.equal(plan.outcomes[0].outcome, 'capped')
  assert.equal(plan.outcomes[0].reason, 'post_daily_limit')
})

// ---- deferred não reserva quota (documentado explicitamente) ----

test('a deferred vote never reserves a slot -- a later eligible vote for the same post/author/day can still fill the cap', () => {
  const votes = [
    {
      ...vote({ voteKey: 'deferred-vote', authorId: 'a1', voterId: 'v1', statusId: 's' }),
      authorEligibility: { status: 'temporarily_ineligible', reason: 'author_suspended', retryAt: 999 },
    },
    vote({ voteKey: 's:v2', authorId: 'a1', voterId: 'v2', statusId: 's' }),
    vote({ voteKey: 's:v3', authorId: 'a1', voterId: 'v3', statusId: 's' }),
    vote({ voteKey: 's:v4', authorId: 'a1', voterId: 'v4', statusId: 's' }),
  ]
  // maxRewardCoinsPerPostDay = 3 -- o voto deferred NÃO consome nada do post, então os
  // 3 votos elegíveis seguintes cabem inteiros, mesmo com o deferred na frente da fila.
  const plan = planSettlementBatch({ votes, initialCounters: {}, limits: { ...LIMITS, maxRewardCoinsPerAuthorDay: 100 } })
  assert.deepEqual(
    plan.outcomes.map((o) => o.outcome),
    ['deferred', 'processed', 'processed', 'processed']
  )
})

// ---- chave natural do ledger ----

test('rewardSettlementNaturalKey is deterministic regardless of input order', () => {
  assert.equal(
    rewardSettlementNaturalKey(['s2:v1', 's1:v2']),
    rewardSettlementNaturalKey(['s1:v2', 's2:v1'])
  )
})

test('rewardSettlementNaturalKey differs for a different set of vote keys', () => {
  assert.notEqual(rewardSettlementNaturalKey(['s1:v1']), rewardSettlementNaturalKey(['s1:v1', 's2:v2']))
})

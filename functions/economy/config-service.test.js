import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConfigService, DEFAULT_ECONOMY_CONFIG } from './config-service.js'

function fakeDb(docData) {
  let reads = 0
  return {
    reads: () => reads,
    doc: () => ({
      async get() {
        reads++
        return docData ? { exists: true, data: () => docData } : { exists: false }
      },
    }),
  }
}

const VALID_DAILY_ACTIVITY = { requiredMinutes: 30, rewardCoins: 3 }
// Todos os 7 campos de voting -- Fase 2 (costCoins/maxVotesPerUserDay) + Fase 3
// (rewardCoinsPerPositiveVote e os 4 limites antifarming, incluindo
// maxRewardedVotesPerVoterDay, o teto agregado por votante/dia).
const VALID_VOTING = {
  costCoins: 3,
  maxVotesPerUserDay: 10,
  rewardCoinsPerPositiveVote: 1,
  maxRewardCoinsPerPostDay: 10,
  maxRewardCoinsPerAuthorDay: 30,
  maxRewardedVotesSameAuthorPerVoterDay: 3,
  maxRewardedVotesPerVoterDay: 20,
}

test('falls back to DEFAULT_ECONOMY_CONFIG and logs a warning when economyConfig/current does not exist', async () => {
  const db = fakeDb(null)
  const warnings = []
  const getEconomyConfig = createConfigService({ db, log: { warn: (msg) => warnings.push(msg) } })
  const config = await getEconomyConfig()
  assert.deepEqual(config, DEFAULT_ECONOMY_CONFIG)
  assert.equal(warnings.length, 1)
})

test('uses the stored document as-is when dailyActivity and voting are both within sane bounds', async () => {
  const stored = {
    dailyActivity: { requiredMinutes: 45, rewardCoins: 5 },
    voting: { ...VALID_VOTING, costCoins: 4, maxVotesPerUserDay: 12 },
    version: 2,
  }
  const db = fakeDb(stored)
  const getEconomyConfig = createConfigService({ db })
  assert.deepEqual(await getEconomyConfig(), stored)
})

// Confirma que um economyConfig/current existente, mas malformado (ausente, NaN,
// negativo ou absurdamente grande), nunca chega inalterado em quem credita EvoCoins --
// dailyActivity cai para o default embutido, sem afetar o resto do documento.
for (const [label, malformedDailyActivity] of [
  ['dailyActivity ausente', undefined],
  ['requiredMinutes negativo', { requiredMinutes: -5, rewardCoins: 3 }],
  ['requiredMinutes NaN', { requiredMinutes: NaN, rewardCoins: 3 }],
  ['requiredMinutes string', { requiredMinutes: '30', rewardCoins: 3 }],
  ['requiredMinutes absurdo (> 24h)', { requiredMinutes: 999999, rewardCoins: 3 }],
  ['rewardCoins negativo', { requiredMinutes: 30, rewardCoins: -3 }],
  ['rewardCoins NaN', { requiredMinutes: 30, rewardCoins: NaN }],
  ['rewardCoins absurdo', { requiredMinutes: 30, rewardCoins: 999999999 }],
  ['rewardCoins zero', { requiredMinutes: 30, rewardCoins: 0 }],
  ['requiredMinutes decimal', { requiredMinutes: 30.5, rewardCoins: 3 }],
  ['rewardCoins decimal', { requiredMinutes: 30, rewardCoins: 3.5 }],
  ['ambos decimais', { requiredMinutes: 29.9, rewardCoins: 2.99 }],
]) {
  test(`economyConfig/current com ${label} cai para o default de dailyActivity, sem travar nem propagar o valor`, async () => {
    const stored = {
      dailyActivity: malformedDailyActivity,
      voting: VALID_VOTING,
      version: 7,
      otherField: 'preserved',
    }
    const db = fakeDb(stored)
    const warnings = []
    const getEconomyConfig = createConfigService({ db, log: { warn: (msg) => warnings.push(msg) } })
    const config = await getEconomyConfig()
    assert.deepEqual(config.dailyActivity, DEFAULT_ECONOMY_CONFIG.dailyActivity)
    // Um bloco malformado nunca deveria contaminar o outro -- voting continua o valor
    // válido gravado, intocado.
    assert.deepEqual(config.voting, VALID_VOTING)
    // O resto do documento (campos que a Fase 1 não usa) não é descartado nem alterado.
    assert.equal(config.version, 7)
    assert.equal(config.otherField, 'preserved')
    assert.equal(warnings.length, 1)
  })
}

// Todos os 7 campos de voting são lidos por algum código hoje (costCoins/
// maxVotesPerUserDay pela Fase 2; os outros 5 pela Fase 3) -- um valor malformado em
// QUALQUER um deles nunca deveria permitir um voto de graça, um limite sem efeito, ou
// uma recompensa/contagem absurda.
for (const [label, malformedVoting] of [
  ['voting ausente', undefined],
  ['costCoins negativo', { ...VALID_VOTING, costCoins: -3 }],
  ['costCoins zero', { ...VALID_VOTING, costCoins: 0 }],
  ['costCoins NaN', { ...VALID_VOTING, costCoins: NaN }],
  ['costCoins decimal', { ...VALID_VOTING, costCoins: 3.5 }],
  ['maxVotesPerUserDay negativo', { ...VALID_VOTING, maxVotesPerUserDay: -10 }],
  ['maxVotesPerUserDay zero', { ...VALID_VOTING, maxVotesPerUserDay: 0 }],
  ['maxVotesPerUserDay NaN', { ...VALID_VOTING, maxVotesPerUserDay: NaN }],
  ['maxVotesPerUserDay absurdo', { ...VALID_VOTING, maxVotesPerUserDay: 999999999 }],
  ['rewardCoinsPerPositiveVote negativo', { ...VALID_VOTING, rewardCoinsPerPositiveVote: -1 }],
  ['rewardCoinsPerPositiveVote zero', { ...VALID_VOTING, rewardCoinsPerPositiveVote: 0 }],
  ['rewardCoinsPerPositiveVote NaN', { ...VALID_VOTING, rewardCoinsPerPositiveVote: NaN }],
  ['rewardCoinsPerPositiveVote decimal', { ...VALID_VOTING, rewardCoinsPerPositiveVote: 1.5 }],
  ['maxRewardCoinsPerPostDay negativo', { ...VALID_VOTING, maxRewardCoinsPerPostDay: -10 }],
  ['maxRewardCoinsPerPostDay zero', { ...VALID_VOTING, maxRewardCoinsPerPostDay: 0 }],
  ['maxRewardCoinsPerPostDay NaN', { ...VALID_VOTING, maxRewardCoinsPerPostDay: NaN }],
  ['maxRewardCoinsPerAuthorDay negativo', { ...VALID_VOTING, maxRewardCoinsPerAuthorDay: -30 }],
  ['maxRewardCoinsPerAuthorDay zero', { ...VALID_VOTING, maxRewardCoinsPerAuthorDay: 0 }],
  ['maxRewardCoinsPerAuthorDay NaN', { ...VALID_VOTING, maxRewardCoinsPerAuthorDay: NaN }],
  [
    'maxRewardedVotesSameAuthorPerVoterDay negativo',
    { ...VALID_VOTING, maxRewardedVotesSameAuthorPerVoterDay: -3 },
  ],
  [
    'maxRewardedVotesSameAuthorPerVoterDay zero',
    { ...VALID_VOTING, maxRewardedVotesSameAuthorPerVoterDay: 0 },
  ],
  [
    'maxRewardedVotesSameAuthorPerVoterDay NaN',
    { ...VALID_VOTING, maxRewardedVotesSameAuthorPerVoterDay: NaN },
  ],
  ['maxRewardedVotesPerVoterDay negativo', { ...VALID_VOTING, maxRewardedVotesPerVoterDay: -20 }],
  ['maxRewardedVotesPerVoterDay zero', { ...VALID_VOTING, maxRewardedVotesPerVoterDay: 0 }],
  ['maxRewardedVotesPerVoterDay NaN', { ...VALID_VOTING, maxRewardedVotesPerVoterDay: NaN }],
  // Validação CRUZADA: cada campo é individualmente "válido" (inteiro positivo dentro do
  // teto de sanidade), mas a COMBINAÇÃO é economicamente absurda -- um único voto já
  // estouraria o teto diário do post/autor, ou o limite por-par excede o agregado.
  [
    'rewardCoinsPerPositiveVote maior que maxRewardCoinsPerPostDay',
    { ...VALID_VOTING, rewardCoinsPerPositiveVote: 50, maxRewardCoinsPerPostDay: 10 },
  ],
  [
    'rewardCoinsPerPositiveVote maior que maxRewardCoinsPerAuthorDay',
    { ...VALID_VOTING, rewardCoinsPerPositiveVote: 50, maxRewardCoinsPerAuthorDay: 30 },
  ],
  [
    'maxRewardedVotesSameAuthorPerVoterDay maior que maxRewardedVotesPerVoterDay',
    { ...VALID_VOTING, maxRewardedVotesSameAuthorPerVoterDay: 25, maxRewardedVotesPerVoterDay: 20 },
  ],
]) {
  test(`economyConfig/current com ${label} cai para o default de voting, sem travar nem propagar o valor`, async () => {
    const stored = {
      dailyActivity: VALID_DAILY_ACTIVITY,
      voting: malformedVoting,
      version: 9,
    }
    const db = fakeDb(stored)
    const warnings = []
    const getEconomyConfig = createConfigService({ db, log: { warn: (msg) => warnings.push(msg) } })
    const config = await getEconomyConfig()
    assert.deepEqual(config.voting, DEFAULT_ECONOMY_CONFIG.voting)
    assert.deepEqual(config.dailyActivity, VALID_DAILY_ACTIVITY)
    assert.equal(warnings.length, 1)
  })
}

test('DEFAULT_ECONOMY_CONFIG.voting itself passes its own cross-validation (sanity check on the fallback)', async () => {
  const db = fakeDb({ dailyActivity: VALID_DAILY_ACTIVITY, voting: DEFAULT_ECONOMY_CONFIG.voting })
  const warnings = []
  const getEconomyConfig = createConfigService({ db, log: { warn: (msg) => warnings.push(msg) } })
  const config = await getEconomyConfig()
  assert.deepEqual(config.voting, DEFAULT_ECONOMY_CONFIG.voting)
  // Se isto disparasse um warning, o próprio fallback estaria inconsistente com a
  // validação que ele deveria satisfazer -- nenhuma reserva aqui, é o valor gravado
  // passando limpo pela validação, não caindo nela.
  assert.equal(warnings.length, 0)
})

test('within the TTL, repeated calls reuse the cached value without rereading Firestore', async () => {
  const db = fakeDb(DEFAULT_ECONOMY_CONFIG)
  let clock = 0
  const getEconomyConfig = createConfigService({ db, ttlMs: 1000, now: () => clock })
  await getEconomyConfig()
  clock += 500
  await getEconomyConfig()
  assert.equal(db.reads(), 1)
})

test('once the TTL expires, the next call rereads Firestore', async () => {
  const db = fakeDb(DEFAULT_ECONOMY_CONFIG)
  let clock = 0
  const getEconomyConfig = createConfigService({ db, ttlMs: 1000, now: () => clock })
  await getEconomyConfig()
  clock += 1001
  await getEconomyConfig()
  assert.equal(db.reads(), 2)
})

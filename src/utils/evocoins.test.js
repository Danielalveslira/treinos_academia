import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  awardDelta,
  dailyCoinsFromServer,
  formatAwardMessage,
  formatDailyProgress,
} from './evocoins.js'

test('mensagem de prêmio no singular e no plural, e nada quando não houve crédito', () => {
  assert.equal(formatAwardMessage(1), '+1 EvoCoin')
  assert.equal(formatAwardMessage(3), '+3 EvoCoins')
  assert.equal(formatAwardMessage(0), null)
  assert.equal(formatAwardMessage(-2), null)
  assert.equal(formatAwardMessage(1.5), null)
  assert.equal(formatAwardMessage(undefined), null)
  assert.equal(formatAwardMessage('abc'), null)
})

test('só aumento de reputação confirmado vira "+N"; gasto e primeira leitura não', () => {
  assert.equal(awardDelta(10, 13), 3)
  assert.equal(awardDelta(10, 10), 0)
  assert.equal(awardDelta(10, 8), 0)
  assert.equal(awardDelta(null, 13), 0)
  assert.equal(awardDelta(undefined, 13), 0)
  assert.equal(awardDelta(10, null), 0)
})

test('progresso diário vem do servidor; dia antigo vale zero', () => {
  const now = new Date('2026-10-03T15:00:00Z')
  const fresh = dailyCoinsFromServer({ dailyEarned: 7, dailyLimit: 10, day: '2026-10-03' }, now)
  assert.deepEqual(fresh, { earned: 7, limit: 10, day: '2026-10-03' })
  assert.equal(formatDailyProgress(fresh, now), 'EvoCoins de hoje: 7 / 10')

  const stale = dailyCoinsFromServer({ dailyEarned: 10, dailyLimit: 10, day: '2026-10-02' }, now)
  assert.equal(stale.earned, 0)
  assert.equal(
    formatDailyProgress({ earned: 10, limit: 10, day: '2026-10-02' }, now),
    'EvoCoins de hoje: 0 / 10'
  )
})

test('resposta inválida ou ausente não inventa números', () => {
  assert.equal(dailyCoinsFromServer(null), null)
  assert.equal(dailyCoinsFromServer({}), null)
  assert.equal(dailyCoinsFromServer({ dailyEarned: 'x', dailyLimit: 10 }), null)
  assert.equal(formatDailyProgress(null), null)
})

test('a virada do dia usa o fuso de São Paulo, não o de UTC', () => {
  const lateEvening = new Date('2026-10-03T02:30:00Z') // 23:30 de 02/10 em SP
  const daily = { earned: 4, limit: 10, day: '2026-10-02' }
  assert.equal(formatDailyProgress(daily, lateEvening), 'EvoCoins de hoje: 4 / 10')
})

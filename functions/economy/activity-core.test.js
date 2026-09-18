import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateCheckpoint,
  todayKey,
  MIN_CHECKPOINT_GAP_MS,
  MAX_CHECKPOINT_GAP_MS,
  MAX_CHECKPOINTS_PER_DAY,
} from './activity-core.js'

const REQUIRED_MINUTES = 30

// Mesma checagem de progress-daily-core.test.js ("uses the Sao Paulo calendar day at
// the UTC midnight boundary"): meia-noite em UTC é 21h do dia anterior em São Paulo
// (UTC-3) -- um bug que usasse a data em UTC em vez do fuso de São Paulo passaria
// despercebido na maior parte do dia e só apareceria exatamente nesta janela de 3h.
test('todayKey uses the Sao Paulo calendar day, not UTC, right across the UTC midnight boundary', () => {
  assert.equal(todayKey(Date.parse('2026-01-15T01:30:00Z')), '2026-01-14')
  assert.equal(todayKey(Date.parse('2026-01-15T03:00:00Z')), '2026-01-15')
})

test('a checkpoint just before and just after the Sao Paulo midnight lands in two different economyDaily days', () => {
  const beforeMidnight = Date.parse('2026-01-14T23:59:00-03:00')
  const afterMidnight = Date.parse('2026-01-15T00:01:00-03:00')
  assert.equal(todayKey(beforeMidnight), '2026-01-14')
  assert.equal(todayKey(afterMidnight), '2026-01-15')
  // A virada de dia não é só uma troca de rótulo -- o segundo checkpoint cai num
  // economyDaily/{date} novo e vazio (daily: null), então activeMinutes nunca herda o
  // que já tinha sido acumulado no dia anterior.
  const secondDayResult = evaluateCheckpoint({
    daily: null,
    nowMs: afterMidnight,
    requiredMinutes: REQUIRED_MINUTES,
  })
  assert.equal(secondDayResult.nextDaily.activeMinutes, 0)
})

// Regressão: economyDaily/{date} é compartilhado com vote-service.js (Fase 2) -- um
// usuário pode votar antes de qualquer checkpoint de atividade no mesmo dia, deixando o
// documento existir com só votesCharged/voteCoinsSpent. Sem tratar os campos de
// atividade ausentes individualmente, "undefined + 1"/"undefined + 0" viravam NaN.
test('a daily doc that already exists but only has vote fields (no prior activity checkpoint) is treated the same as no checkpoint yet', () => {
  const daily = { votesCharged: 5, voteCoinsSpent: 15 }
  const result = evaluateCheckpoint({ daily, nowMs: 1000, requiredMinutes: REQUIRED_MINUTES })
  assert.equal(result.apply, true)
  assert.equal(result.nextDaily.activeMinutes, 0)
  assert.equal(result.nextDaily.checkpointsCount, 1)
  assert.ok(!Number.isNaN(result.nextDaily.activeMinutes))
  assert.ok(!Number.isNaN(result.nextDaily.checkpointsCount))
})

test('the first checkpoint of the day never grants a reward (no previous checkpoint to diff against)', () => {
  const result = evaluateCheckpoint({ daily: null, nowMs: 1000, requiredMinutes: REQUIRED_MINUTES })
  assert.equal(result.apply, true)
  assert.equal(result.rewardEligible, false)
  assert.deepEqual(result.nextDaily, {
    activeMinutes: 0,
    checkpointsCount: 1,
    lastQualifiedActivityAt: 1000,
    activityRewardGranted: false,
  })
})

test('a second checkpoint far enough apart accumulates real elapsed minutes', () => {
  const daily = {
    activeMinutes: 0,
    checkpointsCount: 1,
    lastQualifiedActivityAt: 0,
    activityRewardGranted: false,
  }
  const fifteenMinutesMs = 15 * 60 * 1000
  const result = evaluateCheckpoint({ daily, nowMs: fifteenMinutesMs, requiredMinutes: REQUIRED_MINUTES })
  assert.equal(result.apply, true)
  assert.equal(result.rewardEligible, false)
  assert.equal(result.nextDaily.activeMinutes, 15)
  assert.equal(result.nextDaily.checkpointsCount, 2)
})

test('accumulating past the required minutes marks the reward as eligible', () => {
  const daily = {
    activeMinutes: 15,
    checkpointsCount: 2,
    lastQualifiedActivityAt: 15 * 60 * 1000,
    activityRewardGranted: false,
  }
  const nowMs = 31 * 60 * 1000
  const result = evaluateCheckpoint({ daily, nowMs, requiredMinutes: REQUIRED_MINUTES })
  assert.equal(result.rewardEligible, true)
  assert.equal(result.nextDaily.activeMinutes, 31)
  assert.equal(result.nextDaily.activityRewardGranted, true)
})

test('a checkpoint arriving too soon after the previous one is ignored entirely', () => {
  const daily = {
    activeMinutes: 0,
    checkpointsCount: 1,
    lastQualifiedActivityAt: 0,
    activityRewardGranted: false,
  }
  const result = evaluateCheckpoint({
    daily,
    nowMs: MIN_CHECKPOINT_GAP_MS - 1,
    requiredMinutes: REQUIRED_MINUTES,
  })
  assert.equal(result.apply, false)
  assert.equal(result.reason, 'too_soon')
})

test('a single huge gap (tab left open for hours) is capped, never granting the reward alone', () => {
  const daily = {
    activeMinutes: 0,
    checkpointsCount: 1,
    lastQualifiedActivityAt: 0,
    activityRewardGranted: false,
  }
  const fiveHoursMs = 5 * 60 * 60 * 1000
  const result = evaluateCheckpoint({ daily, nowMs: fiveHoursMs, requiredMinutes: REQUIRED_MINUTES })
  assert.equal(result.apply, true)
  assert.equal(result.nextDaily.activeMinutes, MAX_CHECKPOINT_GAP_MS / 60000)
  assert.ok(result.nextDaily.activeMinutes < REQUIRED_MINUTES)
  assert.equal(result.rewardEligible, false)
})

test('once the reward is granted for the day, every further checkpoint is a no-op', () => {
  const daily = {
    activeMinutes: 31,
    checkpointsCount: 3,
    lastQualifiedActivityAt: 31 * 60 * 1000,
    activityRewardGranted: true,
  }
  const result = evaluateCheckpoint({
    daily,
    nowMs: 60 * 60 * 1000,
    requiredMinutes: REQUIRED_MINUTES,
  })
  assert.equal(result.apply, false)
  assert.equal(result.reason, 'already_granted')
})

test('the daily checkpoint cap stops processing even without a reward', () => {
  const daily = {
    activeMinutes: 5,
    checkpointsCount: MAX_CHECKPOINTS_PER_DAY,
    lastQualifiedActivityAt: 0,
    activityRewardGranted: false,
  }
  const result = evaluateCheckpoint({
    daily,
    nowMs: MAX_CHECKPOINT_GAP_MS,
    requiredMinutes: REQUIRED_MINUTES,
  })
  assert.equal(result.apply, false)
  assert.equal(result.reason, 'checkpoint_cap_reached')
})

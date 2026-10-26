import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runFinishWorkout, FINISH_MESSAGES } from './finishWorkout.js'
const finish = (result) =>
  runFinishWorkout({
    isOnline: () => true,
    getDay: async () => '2026-10-26',
    flushPending: async () => ({}),
    completeSession: async () => result,
    classifyError: () => 'other',
  })
test('structured rejection never navigates; zero coins is valid', async () => {
  for (const result of [
    { reason: 'not_enough_activity', awardedCoins: 0 },
    { status: 'insufficient_activity' },
  ])
    assert.equal((await finish(result)).outcome, 'insufficient')
  for (const status of ['completed', 'already_completed'])
    assert.equal((await finish({ status, awardedCoins: 0 })).outcome, 'done')
  assert.equal((await finish({ status: 'not_allowed' })).outcome, 'invalid')
  assert.equal((await finish(undefined)).outcome, 'error')
  for (const key of ['offline', 'pending', 'attention', 'error', 'insufficient', 'invalid'])
    assert.ok(FINISH_MESSAGES[key])
})

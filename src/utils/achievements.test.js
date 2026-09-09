import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localDayKey, validateAchievement } from './achievements.js'

const today = '2026-09-09'
const valid = { day: today, text: 'Voltei a treinar!', entries: 3, sets: 12 }

test('uses the local calendar day at midnight boundaries', () => {
  assert.equal(localDayKey(new Date(2026, 8, 9, 0, 1)), today)
  assert.equal(localDayKey(new Date(2026, 8, 9, 23, 59)), today)
})

test('allows a personal achievement without exercise records', () => {
  assert.equal(validateAchievement({ ...valid, entries: 0, sets: 0 }, today), null)
  assert.ok(validateAchievement({ ...valid, entries: 0, text: ' ' }, today))
})

test('rejects yesterday preview, invalid totals and oversized text', () => {
  for (const patch of [
    { day: '2026-09-08' },
    { entries: -1 },
    { entries: 1.5 },
    { sets: Infinity },
    { sets: -1 },
    { text: 'a'.repeat(301) },
  ]) {
    assert.ok(validateAchievement({ ...valid, ...patch }, today))
  }
  assert.equal(validateAchievement(valid, today), null)
})

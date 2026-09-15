import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recentExerciseSessions } from './exerciseHistory.js'

test('recent exercise sessions use the latest session and its six previous calendar days', () => {
  const sessions = [
    { id: 'old', date: new Date(2026, 8, 7, 12) },
    { id: 'middle', date: { toDate: () => new Date(2026, 8, 10, 12) } },
    { id: 'latest', date: new Date(2026, 8, 14, 12) },
    { id: 'first-day', date: new Date(2026, 8, 8, 12) },
  ]
  assert.deepEqual(
    recentExerciseSessions(sessions).map(({ id }) => id),
    ['latest', 'middle', 'first-day']
  )
})

test('recent exercise sessions stay newest-first and ignore invalid dates', () => {
  const sessions = [
    { id: 'missing' },
    { id: 'second', date: new Date(2026, 8, 13, 12) },
    { id: 'invalid', date: 'invalid' },
    { id: 'first', date: new Date(2026, 8, 14, 12) },
  ]
  assert.deepEqual(
    recentExerciseSessions(sessions).map(({ id }) => id),
    ['first', 'second']
  )
  assert.deepEqual(recentExerciseSessions(sessions, 0), [])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTrainingConsistency } from './calculations.js'

const now = new Date(2026, 8, 8, 12)
const workout = (year, month, day) => ({ date: new Date(year, month - 1, day, 12) })

test('counts days instead of exercises, includes empty weeks, excludes future dates', () => {
  const result = getTrainingConsistency(
    [
      workout(2026, 9, 7),
      workout(2026, 9, 7),
      workout(2026, 9, 8),
      workout(2026, 9, 6),
      workout(2026, 9, 9),
    ],
    now
  )
  assert.equal(result.total, 3)
  assert.equal(result.frequency, 2)
  assert.equal(result.streak, 2)
  assert.equal(result.chartData.length, 8)
  assert.equal(result.chartData.at(-1).week, '2026-09-07')
  assert.equal(result.chartData.at(-1).isCurrent, true)
  assert.equal(result.chartData.at(-2).count, 1)
  assert.equal(result.chartData[0].count, 0)
})

test('keeps last week streak while current week is pending, but breaks on a missed week', () => {
  assert.equal(getTrainingConsistency([workout(2026, 9, 6), workout(2026, 8, 30)], now).streak, 2)
  assert.equal(getTrainingConsistency([workout(2026, 8, 30)], now).streak, 0)
  assert.equal(getTrainingConsistency([workout(2026, 9, 8), workout(2026, 8, 30)], now).streak, 1)
})

test('handles year boundaries, Firestore timestamps, and empty history', () => {
  const result = getTrainingConsistency(
    [{ date: { toDate: () => new Date(2025, 11, 31, 12) } }, workout(2026, 1, 5)],
    new Date(2026, 0, 5, 15)
  )
  assert.equal(result.streak, 2)
  assert.equal(result.chartData.at(-2).week, '2025-12-29')
  const empty = getTrainingConsistency([], now)
  assert.equal(empty.total, 0)
  assert.equal(empty.streak, 0)
  assert.ok(empty.chartData.every((week) => week.count === 0))
})

test('does not truncate streaks at the chart window or 50 records', () => {
  const workouts = Array.from({ length: 70 }, (_, index) => {
    const date = new Date(now)
    date.setDate(date.getDate() - index * 7)
    return { date }
  })
  const result = getTrainingConsistency(workouts, now)
  assert.equal(result.streak, 70)
  assert.equal(result.total, 70)
  assert.equal(result.chartData.length, 8)
})

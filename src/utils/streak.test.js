import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDailyStreak } from './streak.js'

const workout = (year, month, day, hour = 12) => ({ date: new Date(year, month - 1, day, hour) })

test('counts consecutive days ending today when today is already trained', () => {
  const now = new Date(2026, 8, 11, 20) // 11/09, 20h
  const result = getDailyStreak(
    [workout(2026, 9, 9), workout(2026, 9, 10), workout(2026, 9, 11)],
    now
  )
  assert.equal(result.trainedToday, true)
  assert.equal(result.current, 3)
  assert.equal(result.todayIsUrgent, false)
})

test('keeps yesterday streak alive before today is trained, and flags urgency after 18h', () => {
  const morning = new Date(2026, 8, 11, 9)
  const evening = new Date(2026, 8, 11, 19)
  const workouts = [workout(2026, 9, 9), workout(2026, 9, 10)]

  const beforeUrgent = getDailyStreak(workouts, morning)
  assert.equal(beforeUrgent.trainedToday, false)
  assert.equal(beforeUrgent.current, 2) // ainda não quebrou, hoje só está pendente
  assert.equal(beforeUrgent.todayIsUrgent, false)

  const afterUrgent = getDailyStreak(workouts, evening)
  assert.equal(afterUrgent.current, 2)
  assert.equal(afterUrgent.todayIsUrgent, true)
})

test('breaks the streak when a day is missed entirely, even before the urgency hour', () => {
  const now = new Date(2026, 8, 11, 9)
  // treinou dia 9, pulou o dia 10 inteiro, hoje (11) ainda não treinou
  const result = getDailyStreak([workout(2026, 9, 9)], now)
  assert.equal(result.current, 0)
})

test('longest tracks the best run in the window, independent of the current streak', () => {
  const now = new Date(2026, 9, 1, 12)
  const result = getDailyStreak(
    [
      workout(2026, 9, 1),
      workout(2026, 9, 2),
      workout(2026, 9, 3),
      workout(2026, 9, 4), // sequência de 4, já quebrada
      workout(2026, 9, 30), // sequência atual de 1
    ],
    now
  )
  assert.equal(result.longest, 4)
  assert.equal(result.current, 1)
})

test('last7Days marks today and reflects trained/not-trained per day, ignores same-day duplicates', () => {
  const now = new Date(2026, 8, 11, 12)
  const result = getDailyStreak(
    [workout(2026, 9, 11, 6), workout(2026, 9, 11, 18), workout(2026, 9, 9)],
    now
  )
  assert.equal(result.last7Days.length, 7)
  const today = result.last7Days.at(-1)
  assert.equal(today.date, '2026-09-11')
  assert.equal(today.isToday, true)
  assert.equal(today.trained, true)
  assert.equal(result.last7Days.at(-3).trained, true) // 09/09
  assert.equal(result.last7Days.at(-2).trained, false) // 10/09
})

test('ignores future-dated entries and Firestore Timestamp-shaped dates, empty history streaks at zero', () => {
  const now = new Date(2026, 8, 11, 12)
  const future = getDailyStreak([workout(2026, 9, 12)], now)
  assert.equal(future.current, 0)
  assert.equal(future.trainedToday, false)

  const timestampShaped = getDailyStreak(
    [{ date: { toDate: () => new Date(2026, 8, 11, 8) } }],
    now
  )
  assert.equal(timestampShaped.trainedToday, true)

  const empty = getDailyStreak([], now)
  assert.equal(empty.current, 0)
  assert.equal(empty.longest, 0)
  assert.equal(empty.todayIsUrgent, now.getHours() >= 18)
})

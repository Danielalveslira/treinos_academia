import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildActivityDays,
  buildCalendarWeeks,
  calculateConsistency,
  localDayKey,
} from './activityCalendar.js'
import { buildWeeklyPlanDays } from './trainingPlan.js'

test('new user gets an empty annual calendar and zero consistency', () => {
  const now = new Date(2026, 0, 10, 9)
  const days = buildActivityDays([], { now })
  const result = calculateConsistency(days, now)
  assert.equal(days.length, 365)
  assert.equal(result.current, 0)
  assert.equal(result.longest, 0)
  assert.equal(result.totalWorkouts, 0)
  assert.equal(result.today.state, 'none')
})

test('counts current and best consistency while ignoring duplicate workouts in a day', () => {
  const now = new Date(2026, 8, 11, 20)
  const days = buildActivityDays(
    [
      { dateKey: '2026-09-01', workoutCount: 2 },
      { dateKey: '2026-09-02', workoutCount: 1 },
      { dateKey: '2026-09-03', workoutCount: 1 },
      { dateKey: '2026-09-10', workoutCount: 1 },
      { dateKey: '2026-09-11', workoutCount: 1 },
    ],
    { now }
  )
  const result = calculateConsistency(days, now)
  assert.equal(result.current, 2)
  assert.equal(result.longest, 3)
  assert.equal(result.totalWorkouts, 6)
  assert.equal(result.trainedToday, true)
})

test('a missed day breaks the sequence but today pending does not', () => {
  const now = new Date(2026, 8, 11, 9)
  const activeYesterday = calculateConsistency(
    buildActivityDays(
      [
        { dateKey: '2026-09-09', workoutCount: 1 },
        { dateKey: '2026-09-10', workoutCount: 1 },
      ],
      { now }
    ),
    now
  )
  assert.equal(activeYesterday.current, 2)

  const interrupted = calculateConsistency(
    buildActivityDays([{ dateKey: '2026-09-09', workoutCount: 1 }], { now }),
    now
  )
  assert.equal(interrupted.current, 0)
})

test('planned rest is legitimate consistency and all contextual states remain distinct', () => {
  const now = new Date(2026, 8, 11, 9)
  const days = buildActivityDays([{ dateKey: '2026-09-09', workoutCount: 1 }], {
    now,
    plannedDays: [
      { dateKey: '2026-09-10', state: 'rest' },
      { dateKey: '2026-09-11', state: 'in_progress', title: 'Perna' },
      { dateKey: '2026-09-12', state: 'planned', title: 'Costas' },
    ],
  })
  const byKey = new Map(days.map((day) => [day.dateKey, day]))
  assert.equal(calculateConsistency(days, now).current, 2)
  assert.equal(byKey.get('2026-09-10').state, 'rest')
  assert.equal(byKey.get('2026-09-11').state, 'in_progress')
  assert.equal(byKey.get('2026-09-12').state, 'planned')
})

test('completed activity overrides a generated weekly plan without losing rest states', () => {
  const now = new Date(2026, 9, 7, 20)
  const plan = buildWeeklyPlanDays(
    {
      plannedTrainingDays: ['monday', 'wednesday'],
      reminderEnabled: true,
      reminderTime: '18:00',
      timezone: 'America/Sao_Paulo',
      effectiveFrom: '2026-10-05',
    },
    { now }
  )
  const days = buildActivityDays([{ dateKey: '2026-10-07', workoutCount: 1 }], {
    now,
    plannedDays: plan,
  })
  const byKey = new Map(days.map((day) => [day.dateKey, day]))
  assert.equal(byKey.get('2026-10-06').state, 'rest')
  assert.equal(byKey.get('2026-10-07').state, 'completed')
  assert.equal(calculateConsistency(days, now).current, 2)
})

test('handles leap years, year changes and local civil dates', () => {
  const leapNow = new Date(2028, 11, 31, 12)
  assert.equal(buildActivityDays([], { now: leapNow }).length, 366)

  const newYear = new Date(2027, 0, 1, 8)
  const timeline = buildActivityDays(
    [
      { dateKey: '2026-12-31', workoutCount: 1 },
      { dateKey: '2027-01-01', workoutCount: 1 },
    ],
    { now: newYear, startDate: new Date(2026, 11, 1, 12) }
  )
  assert.equal(calculateConsistency(timeline, newYear).current, 2)
  assert.equal(localDayKey(new Date(2026, 8, 11, 23, 59)), '2026-09-11')
})

test('calendar weeks include all days without squeezing them into rows', () => {
  const days = buildActivityDays([], { now: new Date(2026, 5, 1) })
  const weeks = buildCalendarWeeks(days)
  assert.equal(weeks.length, 53)
  assert.ok(weeks.every((week) => week.length === 7))
})

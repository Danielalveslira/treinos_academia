import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWeeklyPlanDays,
  dayKeyInTimezone,
  isPreferredReminderDue,
  getTrainingTime,
  isValidTrainingTime,
  normalizeTrainingPreferences,
} from './trainingPlan.js'

test('normalizes the weekly plan and removes invalid or duplicate weekdays', () => {
  const result = normalizeTrainingPreferences({
    plannedTrainingDays: ['friday', 'invalid', 'monday', 'friday'],
    reminderEnabled: true,
    reminderTime: '18:30',
    timezone: 'America/Sao_Paulo',
    effectiveFrom: '2026-10-01',
  })
  assert.deepEqual(result.plannedTrainingDays, ['monday', 'friday'])
  assert.equal(result.reminderTime, '18:30')
})

test('expands selected weekdays and treats other configured days as planned rest', () => {
  const preferences = {
    plannedTrainingDays: ['monday', 'wednesday'],
    reminderEnabled: true,
    reminderTime: '07:00',
    timezone: 'America/Sao_Paulo',
    effectiveFrom: '2026-10-05',
  }
  const days = buildWeeklyPlanDays(preferences, {
    now: new Date(2026, 9, 5, 12),
    startDate: new Date(2026, 9, 4, 12),
    endDate: new Date(2026, 9, 8, 12),
  })
  assert.deepEqual(
    days.map(({ dateKey, state }) => ({ dateKey, state })),
    [
      { dateKey: '2026-10-05', state: 'planned' },
      { dateKey: '2026-10-06', state: 'rest' },
      { dateKey: '2026-10-07', state: 'planned' },
      { dateKey: '2026-10-08', state: 'rest' },
    ]
  )
  assert.equal(days[0].reminderTime, '07:00')
  assert.equal(days[1].reminderTime, null)
})

test('an empty selection disables the weekly plan instead of manufacturing rest days', () => {
  assert.deepEqual(
    buildWeeklyPlanDays({ plannedTrainingDays: [], effectiveFrom: '2026-10-01' }),
    []
  )
})

test('uses the configured timezone for effective dates and preferred reminder time', () => {
  const instant = new Date('2026-10-02T01:30:00.000Z')
  assert.equal(dayKeyInTimezone(instant, 'America/Sao_Paulo'), '2026-10-01')
  const preferences = {
    plannedTrainingDays: ['thursday'],
    reminderEnabled: true,
    reminderTime: '22:00',
    timezone: 'America/Sao_Paulo',
    effectiveFrom: '2026-10-01',
  }
  assert.equal(isPreferredReminderDue(preferences, new Date('2026-10-02T00:59:00.000Z')), false)
  assert.equal(isPreferredReminderDue(preferences, new Date('2026-10-02T01:01:00.000Z')), true)
})

test('migrates a legacy global time only onto selected training days', () => {
  const plan = normalizeTrainingPreferences({
    plannedTrainingDays: ['monday', 'wednesday'],
    reminderEnabled: true,
    reminderTime: '06:30',
  })
  assert.deepEqual(plan.weeklyTimes, { 1: '06:30', 3: '06:30' })
  assert.equal(getTrainingTime(plan, 'tuesday'), null)
})

test('weekly times override the global time and inactive days are removed', () => {
  const plan = normalizeTrainingPreferences({
    plannedTrainingDays: ['monday', 'tuesday'],
    reminderEnabled: true,
    reminderTime: '18:00',
    weeklyTimes: { 1: '06:30', 2: '19:00', 3: '09:00', 4: '25:00' },
  })
  assert.deepEqual(plan.weeklyTimes, { 1: '06:30', 2: '19:00' })
  assert.equal(getTrainingTime(plan, 'monday'), '06:30')
  assert.equal(getTrainingTime(plan, 'tuesday'), '19:00')
  assert.equal(getTrainingTime(plan, 'wednesday'), null)
  assert.equal(isValidTrainingTime('24:00'), false)
  assert.equal(isValidTrainingTime('18:30'), true)
})

test('planned calendar exposes each date with its own local clock time', () => {
  const days = buildWeeklyPlanDays(
    {
      plannedTrainingDays: ['monday', 'tuesday'],
      reminderEnabled: true,
      reminderTime: '18:00',
      weeklyTimes: { 1: '06:30', 2: '19:00' },
      effectiveFrom: '2026-10-19',
    },
    { startDate: new Date(2026, 9, 19, 12), endDate: new Date(2026, 9, 21, 12) }
  )
  assert.deepEqual(
    days.map((day) => day.reminderTime),
    ['06:30', '19:00', null]
  )
})

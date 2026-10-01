import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWeeklyPlanDays,
  dayKeyInTimezone,
  isPreferredReminderDue,
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

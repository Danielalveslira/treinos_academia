import { localDayKey } from './activityCalendar.js'
import { businessDayKey } from './businessDate.js'

export const TRAINING_WEEKDAYS = [
  { id: 'monday', short: 'Seg', label: 'Segunda' },
  { id: 'tuesday', short: 'Ter', label: 'Terça' },
  { id: 'wednesday', short: 'Qua', label: 'Quarta' },
  { id: 'thursday', short: 'Qui', label: 'Quinta' },
  { id: 'friday', short: 'Sex', label: 'Sexta' },
  { id: 'saturday', short: 'Sáb', label: 'Sábado' },
  { id: 'sunday', short: 'Dom', label: 'Domingo' },
]

const WEEKDAY_BY_INDEX = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]
const VALID_DAYS = new Set(TRAINING_WEEKDAYS.map((day) => day.id))
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
  } catch {
    return 'America/Sao_Paulo'
  }
}

export function dayKeyInTimezone(date = new Date(), timezone = getDeviceTimezone()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
  } catch {
    return localDayKey(date)
  }
}

export function normalizeTrainingPreferences(value) {
  const selected = new Set(
    Array.isArray(value?.plannedTrainingDays)
      ? value.plannedTrainingDays.filter((day) => VALID_DAYS.has(day))
      : []
  )
  const reminderEnabled = value?.reminderEnabled === true
  return {
    plannedTrainingDays: TRAINING_WEEKDAYS.map((day) => day.id).filter((day) => selected.has(day)),
    reminderEnabled,
    reminderTime:
      reminderEnabled && TIME_PATTERN.test(value?.reminderTime || '') ? value.reminderTime : null,
    timezone:
      typeof value?.timezone === 'string' && value.timezone ? value.timezone : getDeviceTimezone(),
    effectiveFrom: /^\d{4}-\d{2}-\d{2}$/.test(value?.effectiveFrom || '')
      ? value.effectiveFrom
      : null,
    updatedAt: value?.updatedAt || null,
  }
}

export function buildWeeklyPlanDays(preferences, { now = new Date(), startDate, endDate } = {}) {
  const plan = normalizeTrainingPreferences(preferences)
  if (plan.plannedTrainingDays.length === 0 || !plan.effectiveFrom) return []

  const selected = new Set(plan.plannedTrainingDays)
  const year = Number(businessDayKey(now).slice(0, 4))
  const start = startDate || new Date(year, 0, 1, 12)
  const end = endDate || new Date(year, 11, 31, 12)
  const result = []
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const dateKey = localDayKey(cursor)
    if (dateKey < plan.effectiveFrom) continue
    const planned = selected.has(WEEKDAY_BY_INDEX[cursor.getDay()])
    result.push({
      dateKey,
      state: planned ? 'planned' : 'rest',
      title: planned ? 'Treino' : null,
      reminderTime: planned && plan.reminderEnabled ? plan.reminderTime : null,
    })
  }
  return result
}

export function isPreferredReminderDue(preferences, now = new Date()) {
  const plan = normalizeTrainingPreferences(preferences)
  if (!plan.reminderEnabled || !plan.reminderTime) return false
  const currentTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: plan.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  return currentTime >= plan.reminderTime
}

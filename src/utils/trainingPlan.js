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
const ISO_BY_DAY = Object.fromEntries(
  TRAINING_WEEKDAYS.map((day, index) => [day.id, String(index + 1)])
)

export function isValidTrainingTime(value) {
  return typeof value === 'string' && TIME_PATTERN.test(value)
}

export function getTrainingTime(preferences, day) {
  const plan = normalizeTrainingPreferences(preferences)
  return plan.plannedTrainingDays.includes(day) ? (plan.weeklyTimes[ISO_BY_DAY[day]] ?? null) : null
}

export function weekdayInTimezone(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long' })
    .format(date)
    .toLowerCase()
}

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
  const legacyTime = isValidTrainingTime(value?.reminderTime) ? value.reminderTime : null
  const hasWeeklyTimes =
    value?.weeklyTimes && typeof value.weeklyTimes === 'object' && !Array.isArray(value.weeklyTimes)
  const weeklyTimes = {}
  for (const day of selected) {
    const key = ISO_BY_DAY[day]
    const time = hasWeeklyTimes ? value.weeklyTimes[key] : legacyTime
    if (isValidTrainingTime(time)) weeklyTimes[key] = time
  }
  return {
    plannedTrainingDays: TRAINING_WEEKDAYS.map((day) => day.id).filter((day) => selected.has(day)),
    reminderEnabled,
    reminderTime: legacyTime,
    weeklyTimes,
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
      reminderTime:
        planned && plan.reminderEnabled
          ? (plan.weeklyTimes[ISO_BY_DAY[WEEKDAY_BY_INDEX[cursor.getDay()]]] ?? null)
          : null,
    })
  }
  return result
}

export function isPreferredReminderDue(preferences, now = new Date()) {
  const plan = normalizeTrainingPreferences(preferences)
  if (!plan.reminderEnabled) return false
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: plan.timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const weekday = parts.find((part) => part.type === 'weekday')?.value.toLowerCase()
  const time = plan.weeklyTimes[ISO_BY_DAY[weekday]]
  if (!time) return false
  const currentTime = `${parts.find((part) => part.type === 'hour')?.value}:${parts.find((part) => part.type === 'minute')?.value}`
  return currentTime >= time
}

import {
  msUntilNextBusinessDay,
  secondsOfDayIn,
  businessDayKey,
} from '../../utils/businessDate.js'
import {
  getDeviceTimezone,
  getTrainingTime,
  isPreferredReminderDue,
  normalizeTrainingPreferences,
  weekdayInTimezone,
} from '../../utils/trainingPlan.js'
import { getTimePeriod } from './context.js'

// Fronteiras em que a frase PODE mudar sem que nenhum dado tenha mudado. Tudo puro (`now` injetável); o hook
// só agenda UM setTimeout até a próxima.

const SECOND = 1000
const DAY = 86_400_000
const PERIOD_HOURS = [5, 12, 18] // 05:00 manhã, 12:00 tarde, 18:00 noite (hora local do aparelho)
const SAFETY_MARGIN = SECOND // cai já do lado novo da fronteira
const MIN_DELAY = SECOND
const MAX_DELAY = DAY

// Reexportado para não quebrar quem já importa daqui (ver clock.test.js); a implementação mora em
// utils/businessDate.js, de onde a rotação diária de banners da Home também a usa.
export { msUntilNextBusinessDay }

export function msUntilNextLocalPeriod(now = new Date()) {
  const next = new Date(now)
  const hour = PERIOD_HOURS.find((candidate) => candidate > now.getHours())
  if (hour === undefined) {
    next.setDate(next.getDate() + 1)
    next.setHours(PERIOD_HOURS[0], 0, 0, 0)
  } else {
    next.setHours(hour, 0, 0, 0)
  }
  return next.getTime() - now.getTime()
}

// Lembrete no fuso configurado. Fuso inválido cai para o do aparelho; se nem isso funcionar, falha sem lançar.
function reminderOptions(preferences) {
  const plan = normalizeTrainingPreferences(preferences)
  return [plan, { ...plan, timezone: getDeviceTimezone() }]
}

export function isReminderDue(preferences, now = new Date()) {
  for (const candidate of reminderOptions(preferences)) {
    try {
      return isPreferredReminderDue(candidate, now)
    } catch {
      // tenta o próximo fuso
    }
  }
  return false
}

// Falta quanto para o horário do lembrete HOJE; null se não há lembrete ou ele já passou.
export function msUntilReminder(preferences, now = new Date()) {
  for (const plan of reminderOptions(preferences)) {
    if (!plan.reminderEnabled) return null
    try {
      const time = getTrainingTime(plan, weekdayInTimezone(now, plan.timezone))
      if (!time) return null
      const [hour, minute] = time.split(':').map(Number)
      const target = (hour * 3600 + minute * 60) * SECOND
      const current = secondsOfDayIn(plan.timezone, now) * SECOND + now.getMilliseconds()
      return target > current ? target - current : null
    } catch {
      // fuso inválido: tenta o do aparelho
    }
  }
  return null
}

export function msUntilNextGreetingChange(preferences, now = new Date()) {
  const candidates = [msUntilNextBusinessDay(now), msUntilNextLocalPeriod(now)]
  const reminder = msUntilReminder(preferences, now)
  if (reminder != null) candidates.push(reminder)
  const delay = Math.min(...candidates) + SAFETY_MARGIN
  return Math.min(MAX_DELAY, Math.max(MIN_DELAY, delay))
}

// O que, no instante, pode alterar a frase. Se não mudou, o hook mantém o mesmo `now` e não renderiza.
export function clockSignature(preferences, now = new Date()) {
  return `${businessDayKey(now)}|${getTimePeriod(now)}|${isReminderDue(preferences, now) ? 1 : 0}`
}

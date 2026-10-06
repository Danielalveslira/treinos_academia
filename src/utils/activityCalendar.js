import { businessDayKey } from './businessDate.js'

const DAY_MS = 86400000

export function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dateFromKey(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

export function getActivityRange(now = new Date()) {
  const year = Number(businessDayKey(now).slice(0, 4))
  return { start: `${year - 1}-12-01`, end: `${year}-12-31`, year }
}

export function buildActivityDays(
  progressDays,
  { now = new Date(), plannedDays = [], startDate, endDate } = {}
) {
  const byDate = new Map(
    plannedDays.map((day) => [day.dateKey, { ...day, state: day.state || 'planned' }])
  )
  for (const day of progressDays) {
    if (!day?.dateKey || Number(day.workoutCount) < 1) continue
    byDate.set(day.dateKey, {
      ...byDate.get(day.dateKey),
      ...day,
      state: 'completed',
      workoutCount: Number(day.workoutCount),
    })
  }

  const today = businessDayKey(now)
  const year = Number(today.slice(0, 4))
  const days = []
  const rangeStart = startDate || new Date(year, 0, 1, 12)
  const rangeEnd = endDate || new Date(year, 11, 31, 12)
  for (
    const cursor = new Date(rangeStart);
    cursor <= rangeEnd;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dateKey = localDayKey(cursor)
    const existing = byDate.get(dateKey)
    days.push({
      dateKey,
      state: existing?.state || 'none',
      workoutCount: existing?.workoutCount || 0,
      exerciseStats: existing?.exerciseStats || [],
      title: existing?.title || null,
      reminderTime: existing?.reminderTime || null,
      isToday: dateKey === today,
      isFuture: dateKey > today,
    })
  }
  return days
}

function countsForConsistency(state) {
  return state === 'completed' || state === 'rest'
}

export function calculateConsistency(activityDays, now = new Date()) {
  const today = businessDayKey(now)
  const knownDays = activityDays.filter((day) => day.dateKey <= today)
  const byDate = new Map(knownDays.map((day) => [day.dateKey, day]))
  const completed = knownDays.filter((day) => day.state === 'completed')

  let current = 0
  const cursor = dateFromKey(today)
  if (!countsForConsistency(byDate.get(today)?.state)) cursor.setDate(cursor.getDate() - 1)
  while (countsForConsistency(byDate.get(localDayKey(cursor))?.state)) {
    current += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  let longest = 0
  let run = 0
  let previous = null
  for (const day of knownDays) {
    if (!countsForConsistency(day.state)) {
      run = 0
      previous = dateFromKey(day.dateKey)
      continue
    }
    const date = dateFromKey(day.dateKey)
    const diff = previous ? Math.round((date - previous) / DAY_MS) : null
    run = diff === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = date
  }

  const recent = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now)
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - (6 - index))
    return (
      byDate.get(localDayKey(date)) || {
        dateKey: localDayKey(date),
        state: 'none',
        workoutCount: 0,
        isToday: index === 6,
      }
    )
  })

  return {
    current,
    longest,
    totalWorkouts: completed.reduce((sum, day) => sum + day.workoutCount, 0),
    trainedToday: byDate.get(today)?.state === 'completed',
    today: byDate.get(today) || { dateKey: today, state: 'none', workoutCount: 0, isToday: true },
    recent,
  }
}

export function buildCalendarWeeks(days) {
  if (days.length === 0) return []
  const leading = (dateFromKey(days[0].dateKey).getDay() + 6) % 7
  const cells = [...Array(leading).fill(null), ...days]
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7)
  )
}

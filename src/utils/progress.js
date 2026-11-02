import { businessDayKey } from './businessDate.js'

export const PROGRESS_PERIODS = ['today', 'week', 'month', 'quarter', 'year']

function startOfDay(value) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(value, days) {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date
}

export function dateKey(value) {
  const date = startOfDay(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getProgressPeriod(period, now = new Date()) {
  const [year, month, day] = businessDayKey(now).split('-').map(Number)
  const end = new Date(year, month - 1, day)
  let start
  if (period === 'today') start = new Date(end)
  else if (period === 'week') start = addDays(end, -6)
  else if (period === 'month') start = new Date(end.getFullYear(), end.getMonth(), 1)
  else if (period === 'quarter') {
    start = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1)
  } else start = new Date(end.getFullYear(), 0, 1)

  const elapsedDays =
    Math.round(
      (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
        Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
        86400000
    ) + 1
  let previousStart
  if (period === 'month') previousStart = new Date(start.getFullYear(), start.getMonth() - 1, 1)
  else if (period === 'quarter') {
    previousStart = new Date(start.getFullYear(), start.getMonth() - 3, 1)
  } else if (period === 'year') previousStart = new Date(start.getFullYear() - 1, 0, 1)
  else previousStart = addDays(start, -elapsedDays)
  const previousPeriodEnd = addDays(start, -1)
  const equivalentEnd = addDays(previousStart, elapsedDays - 1)
  const previousEnd = equivalentEnd < previousPeriodEnd ? equivalentEnd : previousPeriodEnd
  return { start, end, previousStart, previousEnd }
}

export function aggregateProgress(days) {
  const exerciseIds = new Set()
  const totals = days.reduce(
    (result, day) => {
      result.trainingDays += day.workoutCount > 0 ? 1 : 0
      // O contrato legado chama cada registro de exercício de workoutCount.
      result.exerciseRecords += Number(day.workoutCount) || 0
      result.volumeKg += Number(day.strengthVolumeKg) || 0
      result.sets += Number(day.strengthSets) || 0
      result.reps += Number(day.strengthReps) || 0
      result.cardioMinutes += Number(day.cardioMinutes) || 0
      result.cardioDistanceKm += Number(day.cardioDistanceKm) || 0
      for (const exercise of day.exerciseStats || []) exerciseIds.add(exercise.exerciseId)
      return result
    },
    {
      trainingDays: 0,
      exerciseRecords: 0,
      volumeKg: 0,
      sets: 0,
      reps: 0,
      cardioMinutes: 0,
      cardioDistanceKm: 0,
    }
  )
  return {
    ...totals,
    averageVolumePerActiveDay: totals.trainingDays ? totals.volumeKg / totals.trainingDays : 0,
    distinctExercises: exerciseIds.size,
  }
}

export function percentChange(current, previous) {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}

function sumMetric(day, metric) {
  if (metric === 'trainingDays') return day.workoutCount > 0 ? 1 : 0
  return Number(day[metric]) || 0
}

function weekStart(value) {
  const date = startOfDay(value)
  const weekday = date.getDay() || 7
  return addDays(date, 1 - weekday)
}

function chartGroupKey(date, period, start) {
  if (period === 'month' || period === 'quarter') {
    const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    const first = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
    return dateKey(addDays(start, Math.floor((day - first) / 86400000 / 7) * 7))
  }
  if (period === 'year') return dateKey(new Date(date.getFullYear(), date.getMonth(), 1))
  return dateKey(date)
}

export function buildProgressChart(days, period, metric, range, exerciseNames = new Map()) {
  if (period === 'today') {
    if (metric === 'trainingDays')
      return [
        {
          key: dateKey(range.start),
          label: range.start.toLocaleDateString('pt-BR'),
          value: days.some((day) => day.workoutCount > 0) ? 1 : 0,
        },
      ]
    const exerciseMetric = metric
    return (days[0]?.exerciseStats || [])
      .map((item) => ({
        key: item.exerciseId,
        label: exerciseNames.get(item.exerciseId) || 'Exercício',
        value: Number(item[exerciseMetric]) || 0,
      }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value)
  }

  const groups = new Map()
  const cursor = new Date(range.start)
  while (cursor <= range.end) {
    const key = chartGroupKey(cursor, period, range.start)
    if (!groups.has(key)) groups.set(key, { key, date: new Date(cursor), value: 0 })
    groups.get(key).endDate = new Date(cursor)
    cursor.setDate(cursor.getDate() + 1)
  }
  for (const day of days) {
    const date = new Date(`${day.dateKey}T12:00:00`)
    const key = chartGroupKey(date, period, range.start)
    const group = groups.get(key)
    if (group) group.value += sumMetric(day, metric)
  }
  return [...groups.values()].map((item) => ({
    ...item,
    dateRange:
      dateKey(item.date) === dateKey(item.endDate)
        ? dateKey(item.date)
        : `${dateKey(item.date)} a ${dateKey(item.endDate)}`,
    label:
      period === 'year'
        ? item.date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
        : period === 'quarter'
          ? item.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
          : item.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
  }))
}

export function buildProgressComparisonChart(
  currentDays,
  previousDays,
  period,
  metric,
  range,
  exerciseNames = new Map()
) {
  const current = buildProgressChart(currentDays, period, metric, range, exerciseNames)
  const previous = buildProgressChart(
    previousDays,
    period,
    metric,
    { start: range.previousStart, end: range.previousEnd },
    exerciseNames
  )
  const previousByExercise = new Map(previous.map((point) => [point.key, point.value]))
  const points =
    period === 'today' && metric !== 'trainingDays'
      ? [
          ...current,
          ...previous
            .filter((point) => !current.some((item) => item.key === point.key))
            .map((point) => ({ ...point, value: 0 })),
        ]
      : current
  return points.map((point, index) => ({
    ...point,
    currentValue: point.value,
    currentDate: period === 'today' ? dateKey(range.start) : point.dateRange,
    previousDate:
      period === 'today'
        ? dateKey(range.previousStart)
        : previous[index]?.dateRange || dateKey(range.previousStart),
    previousValue:
      period === 'today' ? previousByExercise.get(point.key) || 0 : previous[index]?.value || 0,
  }))
}

export function getStrengthExerciseIds(days) {
  const ids = new Set()
  for (const day of days) {
    for (const item of day.exerciseStats || []) {
      if ((Number(item.strengthSets) || 0) > 0) ids.add(item.exerciseId)
    }
  }
  return [...ids]
}

export function summarizeExerciseStrength(days, exerciseId) {
  const entries = days
    .flatMap((day) =>
      (day.exerciseStats || [])
        .filter((item) => item.exerciseId === exerciseId && (Number(item.strengthSets) || 0) > 0)
        .map((item) => ({ ...item, dateKey: day.dateKey }))
    )
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  const summary = entries.reduce(
    (result, item) => {
      const weight = Number(item.maxWeightKg) || 0
      const reps = Number(item.repsAtMaxWeight) || 0
      if (weight > result.bestWeightKg || (weight === result.bestWeightKg && reps > result.reps)) {
        result.bestWeightKg = weight
        result.reps = reps
      }
      result.bestSetVolumeKg = Math.max(result.bestSetVolumeKg, Number(item.bestSetVolumeKg) || 0)
      result.estimated1RMKg = Math.max(result.estimated1RMKg, Number(item.estimated1RMKg) || 0)
      result.sets += Number(item.strengthSets) || 0
      result.totalReps += Number(item.strengthReps) || 0
      return result
    },
    { bestWeightKg: 0, reps: 0, bestSetVolumeKg: 0, estimated1RMKg: 0, sets: 0, totalReps: 0 }
  )
  const recent = entries.at(-1)
  return {
    ...summary,
    recentWeightKg: Number(recent?.maxWeightKg) || 0,
    recentReps: Number(recent?.repsAtMaxWeight) || 0,
  }
}

export function buildStrengthWeeklySeries(days, exerciseId) {
  const groups = new Map()
  for (const day of days) {
    const item = (day.exerciseStats || []).find((entry) => entry.exerciseId === exerciseId)
    if (!item || !(Number(item.strengthSets) > 0)) continue
    const date = new Date(`${day.dateKey}T12:00:00`)
    const key = dateKey(weekStart(date))
    const current = groups.get(key) || {
      key,
      date: weekStart(date),
      maxWeightKg: 0,
      estimated1RMKg: 0,
    }
    current.maxWeightKg = Math.max(current.maxWeightKg, Number(item.maxWeightKg) || 0)
    current.estimated1RMKg = Math.max(current.estimated1RMKg, Number(item.estimated1RMKg) || 0)
    groups.set(key, current)
  }
  return [...groups.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((item) => ({
      ...item,
      label: item.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    }))
}

export function aggregateMuscleGroups(days, muscleGroupsByExercise = new Map()) {
  const groups = new Map()
  for (const day of days) {
    for (const item of day.exerciseStats || []) {
      const muscleGroup = muscleGroupsByExercise.get(item.exerciseId) || 'Não informado'
      groups.set(muscleGroup, (groups.get(muscleGroup) || 0) + (Number(item.strengthSets) || 0))
    }
  }
  return [...groups.entries()]
    .map(([muscleGroup, sets]) => ({ muscleGroup, sets }))
    .sort((a, b) => b.sets - a.sets)
}

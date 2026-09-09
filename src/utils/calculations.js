export function calculateVolume(weight, sets, reps) {
  return weight * sets * reps
}

function calculateEvolutionPercent(currentLoad, previousLoad) {
  if (previousLoad == null || previousLoad === 0) return null
  return ((currentLoad - previousLoad) / previousLoad) * 100
}

function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value)
}

function sortByDateDesc(workouts) {
  return [...workouts].sort((a, b) => toDate(b.date) - toDate(a.date))
}

export function getExerciseIndicators(workouts) {
  if (!workouts || workouts.length === 0) {
    return {
      currentLoad: null,
      previousLoad: null,
      maxLoad: null,
      evolutionPercent: null,
      lastVolume: null,
      accumulatedVolume: 0,
      sessionCount: 0,
      lastWorkoutDate: null,
    }
  }

  const sorted = sortByDateDesc(workouts)
  const [latest, previous] = sorted

  const accumulatedVolume = sorted.reduce(
    (sum, w) => sum + calculateVolume(w.weight, w.sets, w.reps),
    0
  )

  const maxLoad = Math.max(...sorted.map((w) => w.weight))

  return {
    currentLoad: latest.weight,
    previousLoad: previous ? previous.weight : null,
    maxLoad,
    evolutionPercent: calculateEvolutionPercent(latest.weight, previous?.weight),
    lastVolume: calculateVolume(latest.weight, latest.sets, latest.reps),
    accumulatedVolume,
    sessionCount: sorted.length,
    lastWorkoutDate: toDate(latest.date),
    isPersonalRecord: sorted.length > 1 && latest.weight >= maxLoad,
  }
}

export function getWeeklyFrequency(workouts) {
  if (!workouts || workouts.length === 0) return 0

  const now = new Date()
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 7)

  const uniqueDays = new Set(
    workouts.filter((w) => toDate(w.date) >= sevenDaysAgo).map((w) => toDate(w.date).toDateString())
  )

  return uniqueDays.size
}

export function groupVolumeByDate(workouts) {
  const totals = new Map()

  for (const w of workouts) {
    const key = toDate(w.date).toISOString().slice(0, 10)
    const volume = calculateVolume(w.weight, w.sets, w.reps)
    totals.set(key, (totals.get(key) || 0) + volume)
  }

  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, volume]) => ({ date, volume }))
}

export function buildLoadHistory(workouts) {
  return sortByDateDesc(workouts)
    .slice()
    .reverse()
    .map((w) => ({
      date: toDate(w.date).toISOString().slice(0, 10),
      weight: w.weight,
    }))
}

function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfWeek(date) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}

export function getTrainingConsistency(workouts, now = new Date(), weekCount = 8) {
  const today = new Date(now)
  today.setHours(23, 59, 59, 999)
  const currentWeek = startOfWeek(now)
  const days = new Set()
  const weeks = new Map()

  for (const workout of workouts) {
    const date = toDate(workout.date)
    if (Number.isNaN(date.getTime()) || date > today) continue
    const day = localDayKey(date)
    if (days.has(day)) continue
    days.add(day)
    const week = localDayKey(startOfWeek(date))
    weeks.set(week, (weeks.get(week) || 0) + 1)
  }

  const chartData = Array.from({ length: weekCount }, (_, index) => {
    const start = new Date(currentWeek)
    start.setDate(start.getDate() - (weekCount - 1 - index) * 7)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const week = localDayKey(start)
    return {
      week,
      label: start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      range: `${start.toLocaleDateString('pt-BR')} a ${end.toLocaleDateString('pt-BR')}`,
      count: weeks.get(week) || 0,
      isCurrent: index === weekCount - 1,
    }
  })

  let streak = 0
  const cursor = new Date(currentWeek)
  if (!weeks.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 7)
  while (weeks.has(localDayKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 7)
  }

  return {
    total: days.size,
    frequency: weeks.get(localDayKey(currentWeek)) || 0,
    streak,
    chartData,
  }
}

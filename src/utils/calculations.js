export function calculateVolume(weight, sets, reps) {
  return weight * sets * reps
}

export function calculateEvolutionPercent(currentLoad, previousLoad) {
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

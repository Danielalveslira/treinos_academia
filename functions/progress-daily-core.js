function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function strengthSets(workout) {
  if (Array.isArray(workout.setDetails)) return workout.setDetails
  const count = Number.isSafeInteger(workout.sets) && workout.sets > 0 ? workout.sets : 0
  return Array.from({ length: count }, () => ({
    weight: workout.weight,
    reps: workout.reps ?? workout.repetitions,
  }))
}

// Fórmula de Epley. A faixa de 1–12 repetições evita apresentar como útil uma
// extrapolação muito distante; séries sem carga não geram estimativa.
export function estimateOneRepMax(weight, reps) {
  const load = number(weight)
  const repetitions = number(reps)
  if (load <= 0 || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 12) {
    return 0
  }
  return load * (1 + repetitions / 30)
}

const BRAZIL_DATE_FORMAT = new Intl.DateTimeFormat('en', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function workoutDateKey(workout) {
  const date = workout?.date?.toDate ? workout.date.toDate() : new Date(workout?.date)
  if (Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(
    BRAZIL_DATE_FORMAT.formatToParts(date).map(({ type, value }) => [type, value])
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function summarizeDailyWorkouts(workouts) {
  const exerciseStats = new Map()
  const summary = {
    workoutCount: workouts.length,
    strengthVolumeKg: 0,
    strengthSets: 0,
    strengthReps: 0,
    cardioMinutes: 0,
    cardioDistanceKm: 0,
  }

  for (const workout of workouts) {
    const current = exerciseStats.get(workout.exerciseId) || {
      exerciseId: workout.exerciseId,
      workoutCount: 0,
      strengthVolumeKg: 0,
      strengthSets: 0,
      strengthReps: 0,
      maxWeightKg: 0,
      repsAtMaxWeight: 0,
      bestSetVolumeKg: 0,
      estimated1RMKg: 0,
      cardioMinutes: 0,
      cardioDistanceKm: 0,
    }
    current.workoutCount += 1
    if (workout.type === 'cardio') {
      const minutes = number(workout.durationMinutes)
      const distance = number(workout.distanceKm)
      summary.cardioMinutes += minutes
      summary.cardioDistanceKm += distance
      current.cardioMinutes += minutes
      current.cardioDistanceKm += distance
    } else {
      const sets = strengthSets(workout)
      const volume = sets.reduce((total, set) => total + number(set.weight) * number(set.reps), 0)
      const reps = sets.reduce((total, set) => total + number(set.reps), 0)
      summary.strengthVolumeKg += volume
      summary.strengthSets += sets.length
      summary.strengthReps += reps
      current.strengthVolumeKg += volume
      current.strengthSets += sets.length
      current.strengthReps += reps
      for (const set of sets) {
        const weight = number(set.weight)
        const setReps = number(set.reps)
        const setVolume = weight * setReps
        if (
          weight > current.maxWeightKg ||
          (weight === current.maxWeightKg && setReps > current.repsAtMaxWeight)
        ) {
          current.maxWeightKg = weight
          current.repsAtMaxWeight = setReps
        }
        current.bestSetVolumeKg = Math.max(current.bestSetVolumeKg, setVolume)
        current.estimated1RMKg = Math.max(
          current.estimated1RMKg,
          estimateOneRepMax(weight, setReps)
        )
      }
    }
    exerciseStats.set(workout.exerciseId, current)
  }

  return {
    ...summary,
    active: workouts.length > 0,
    exerciseStats: [...exerciseStats.values()].sort((a, b) =>
      a.exerciseId.localeCompare(b.exerciseId)
    ),
  }
}

// Keep `sets` as a derived count for existing Firestore sum('sets') queries.
// Firestore rules validate each list position explicitly; keep this limit in sync.
export const MAX_WORKOUT_SETS = 10

export function getWorkoutSets(workout) {
  if (Array.isArray(workout.setDetails)) return workout.setDetails.map((set) => ({ ...set }))
  if (!Number.isSafeInteger(workout.sets) || workout.sets < 1) return []
  return Array.from({ length: workout.sets }, () => ({
    weight: workout.weight,
    reps: workout.reps ?? workout.repetitions,
  }))
}

export function normalizeWorkout(workout) {
  const setDetails = getWorkoutSets(workout)
  return { ...workout, setDetails, sets: setDetails.length }
}

export function isValidSet(set) {
  const numeric = (value) =>
    (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
    Number.isFinite(Number(value))
  return Boolean(
    set &&
    numeric(set.weight) &&
    Number(set.weight) >= 0 &&
    Number(set.weight) <= 10000 &&
    numeric(set.reps) &&
    Number.isInteger(Number(set.reps)) &&
    Number(set.reps) > 0 &&
    Number(set.reps) <= 100000
  )
}

export function getWorkoutLoad(workout) {
  return Math.max(0, ...getWorkoutSets(workout).map((set) => Number(set.weight)))
}

export function formatWorkoutSets(workout) {
  return getWorkoutSets(workout)
    .map(
      (set, index) =>
        `Série ${index + 1}: ${Number(set.weight).toLocaleString('pt-BR')} kg × ${set.reps} reps`
    )
    .join(' · ')
}

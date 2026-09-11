// Mesmos tetos de firestore.rules (isValidCardioSession) — manter em sincronia.
export const MAX_DURATION_MINUTES = 600
export const MAX_DISTANCE_KM = 500

export function isCardioWorkout(workout) {
  return workout?.type === 'cardio'
}

export function isValidCardioSession({ durationMinutes, distanceKm }) {
  const numeric = (value) =>
    (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
    Number.isFinite(Number(value))
  if (!numeric(durationMinutes)) return false
  const duration = Number(durationMinutes)
  if (duration <= 0 || duration > MAX_DURATION_MINUTES) return false
  if (distanceKm == null || distanceKm === '') return true
  if (!numeric(distanceKm)) return false
  const distance = Number(distanceKm)
  return distance > 0 && distance <= MAX_DISTANCE_KM
}

export function formatCardioSession(workout) {
  const parts = [`${Number(workout.durationMinutes).toLocaleString('pt-BR')} min`]
  if (workout.distanceKm != null) {
    parts.push(
      `${Number(workout.distanceKm).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km`
    )
  }
  return parts.join(' · ')
}

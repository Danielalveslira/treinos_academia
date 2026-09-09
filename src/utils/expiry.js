export function toMillis(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  return new Date(value).getTime()
}

// Arredonda para baixo mas nunca mostra "0min" enquanto a publicação ainda não expirou.
export function formatTimeRemaining(remainingMs) {
  if (remainingMs <= 0) return null
  const totalMinutes = Math.max(1, Math.floor(remainingMs / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `Expira em ${hours}h ${minutes}min` : `Expira em ${minutes}min`
}

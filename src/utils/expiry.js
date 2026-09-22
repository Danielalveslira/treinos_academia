export function toMillis(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  return new Date(value).getTime()
}

// Usa horas totais, sem converter 52h em "2 dias", para manter o mesmo vocabulário das
// promoções. O piso evita prometer tempo que já acabou; o mínimo de 1min só vale quando
// ainda existe algum tempo positivo.
export function formatRemainingTime(remainingMs, endedLabel = 'Expirado') {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return endedLabel
  const totalMinutes = Math.max(1, Math.floor(remainingMs / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}min restantes`
  if (minutes === 0) return `${hours}h restantes`
  return `${hours}h${minutes}min restantes`
}

export function formatPublicationDateTime(value) {
  const millis = toMillis(value)
  if (!Number.isFinite(millis) || millis <= 0) return '—'
  const date = new Date(millis)
  const day = date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const time = date
    .toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
    .replace(':', 'h')
  return `${day} às ${time}`
}

import { toDate } from './date.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Tempo relativo curto para o cartão da comunidade ("agora", "há 5 min", "há 2h", "há 3d");
// a partir de 30 dias cai na data curta, que é mais útil do que "há 90d". Nunca lança:
// data ausente/inválida vira null (o chamador simplesmente omite o tempo).
export function formatRelativeTime(value, now = Date.now()) {
  const date = toDate(value)
  if (!date) return null
  const elapsed = Math.max(0, now - date.getTime())
  if (elapsed < MINUTE) return 'agora'
  if (elapsed < HOUR) return `há ${Math.floor(elapsed / MINUTE)} min`
  if (elapsed < DAY) return `há ${Math.floor(elapsed / HOUR)}h`
  if (elapsed < 30 * DAY) return `há ${Math.floor(elapsed / DAY)}d`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

// Trecho de uma linha da última publicação, para a prévia do cartão (o CSS ainda corta
// por linhas; este limite só evita levar um texto enorme ao DOM).
const MAX_PREVIEW_LENGTH = 140

export function describeActivityPreview(status) {
  if (!status) return ''
  let text = ''
  switch (status.type) {
    case 'text':
      text = clean(status.text)
      break
    case 'poll':
      text = `Enquete: ${clean(status.poll?.question)}`
      break
    case 'workout':
      text = `Treino marcado: ${clean(status.workout?.title)}`
      break
    case 'achievement':
      text = clean(status.achievement?.text) || 'Compartilhou uma conquista'
      break
    case 'photo':
      text = clean(status.caption) || 'Compartilhou uma foto'
      break
    default:
      text = ''
  }
  return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH - 1)}…` : text
}

export function formatMemberCount(count) {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  if (n >= 1000) {
    const thousands = (Math.floor(n / 100) / 10).toLocaleString('pt-BR', {
      maximumFractionDigits: 1,
    })
    return `${thousands} mil membros`
  }
  return `${n} ${n === 1 ? 'membro' : 'membros'}`
}

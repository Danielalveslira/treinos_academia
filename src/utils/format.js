import { toDate } from './date.js'

export function formatPercent(value) {
  if (value == null) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export function formatWeight(value) {
  if (value == null) return '—'
  const rounded = Math.round(value * 100) / 100
  return `${rounded.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}kg`
}

// Aceitam Date, string ISO (Supabase), número (ms) ou resíduo legado -- tudo passa por toDate, então
// um valor ausente ou inválido vira '—' em vez de "Invalid Date" ou de um TypeError (ex.: string ISO
// não tem toLocaleDateString).
export function formatDate(value) {
  const date = toDate(value)
  return date ? date.toLocaleDateString('pt-BR') : '—'
}

export function formatDateTime(value) {
  const date = toDate(value)
  return date ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

export function formatTime(value) {
  const date = toDate(value)
  return date ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
}

// EvoCash (Fase 4): preço sempre gravado como inteiro em centavos (nunca float de
// reais, ver cash-purchase-core.js) -- só a exibição converte para reais.
export function formatCentavosBRL(amountCentavos) {
  if (amountCentavos == null) return '—'
  return (amountCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function buildExerciseNameMap(exercises) {
  const map = new Map()
  exercises.forEach((ex) => map.set(ex.id, ex.name))
  return map
}

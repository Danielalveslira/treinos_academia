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

export function formatDate(value) {
  if (!value) return '—'
  return value.toLocaleDateString('pt-BR')
}

export function formatDateTime(value) {
  if (!value) return '—'
  return value.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
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

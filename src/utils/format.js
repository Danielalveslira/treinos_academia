export function formatPercent(value) {
  if (value == null) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export function formatWeight(value) {
  if (value == null) return '—'
  return `${value}kg`
}

export function formatDate(value) {
  if (!value) return '—'
  return value.toLocaleDateString('pt-BR')
}

export function buildExerciseNameMap(exercises) {
  const map = new Map()
  exercises.forEach((ex) => map.set(ex.id, ex.name))
  return map
}

import { isBusinessDayKey } from './businessDate.js'

export const validSheetId = (id) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')

export function validPlannedDate(value) {
  if (!isBusinessDayKey(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// Only these selection intentions cross the legacy entry boundary.
export function sheetPickerUrl(search) {
  const source = new URLSearchParams(search)
  const next = new URLSearchParams()
  const exercise = source.get('exercicio')
  if (validSheetId(exercise)) next.set('exercicio', exercise)
  const planned = source.get('planejado')
  if (validPlannedDate(planned)) next.set('planejado', planned)
  return '/treinar' + (next.size ? `?${next}` : '')
}

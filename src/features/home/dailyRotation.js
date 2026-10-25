import { businessDayKey } from '../../utils/businessDate.js'

// Índice determinístico por dia de negócio (America/Sao_Paulo): round-robin puro sobre a contagem de
// dias desde a época, SEM Math.random nem hash -- todo mundo vê a mesma foto no mesmo dia, e a
// sequência reinicia sozinha (módulo) depois da última. `dayKey` é uma chave 'YYYY-MM-DD' já
// validada por businessDayKey (ver utils/businessDate.js).
export function dailyRotationIndex(dayKey, length) {
  if (!Number.isInteger(length) || length <= 0) return 0
  const [year, month, day] = dayKey.split('-').map(Number)
  const epochDay = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
  return ((epochDay % length) + length) % length
}

// A foto do dia de negócio atual (ou `now`, injetável para teste). `null` sem fotos aprovadas.
export function pickDailyItem(items, now = new Date()) {
  if (!items?.length) return null
  return items[dailyRotationIndex(businessDayKey(now), items.length)]
}

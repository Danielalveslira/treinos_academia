import { useSyncExternalStore } from 'react'

// Relógio ÚNICO e compartilhado do app (um setInterval só, e só enquanto houver quem escute).
// Em vez de passar `now` por props até todo card (o que re-renderizava o feed inteiro a cada
// tick), cada componente assina só o que realmente depende da hora, por um seletor que devolve
// um valor primitivo: o componente só re-renderiza quando esse valor muda (ex.: a promoção
// acabou), e não a cada tick.
export const CLOCK_TICK_MS = 15000

let now = Date.now()
let timer = null
const listeners = new Set()

function tick() {
  now = Date.now()
  listeners.forEach((listener) => listener())
}

export function subscribeClock(listener) {
  listeners.add(listener)
  if (timer === null) {
    now = Date.now()
    timer = setInterval(tick, CLOCK_TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

// Sem assinantes o relógio não anda: o valor é lido na hora, no máximo uma vez por chamada.
function currentNow() {
  if (timer === null) now = Date.now()
  return now
}

export function useClockSelector(select) {
  return useSyncExternalStore(
    subscribeClock,
    () => select(currentNow()),
    () => select(Date.now())
  )
}

// `nowOverride` (testes/estados congelados) tem prioridade sobre o relógio.
export function useNowSelector(nowOverride, select, toMillis) {
  const live = useClockSelector(select)
  return nowOverride !== undefined && nowOverride !== null ? select(toMillis(nowOverride)) : live
}

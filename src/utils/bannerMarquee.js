// Tempos da rolagem da mensagem do banner patrocinado. Funções puras (sem DOM, sem timers), para o componente só
// medir o excesso de largura e delegar o resto: o mesmo número rege a animação (transform) e o avanço do rodízio,
// então a campanha seguinte só entra depois que a mensagem foi exibida por inteiro.

export const DWELL_MS = 7000 // tempo padrão de cada campanha (mensagem que cabe, sem animação)
export const START_PAUSE_MS = 1200 // leitura do começo antes de deslizar
export const END_PAUSE_MS = 1500 // leitura do final antes de seguir
export const SCROLL_SPEED_PX_S = 45 // velocidade constante e confortável de leitura
export const FADE_PX = 14 // faixa com degradê na borda direita: o texto para antes dela

// Abaixo disso o texto "cabe" (arredondamento de subpixel não deve acionar animação).
export const OVERFLOW_TOLERANCE_PX = 1

export function measureOverflow(textWidth, viewportWidth) {
  const excess = Math.ceil(textWidth - viewportWidth)
  return excess > OVERFLOW_TOLERANCE_PX ? excess : 0
}

// `overflow` = quantos px o texto passa da largura visível (0 = cabe).
export function marqueeTiming(overflow) {
  if (!(overflow > 0)) return { animated: false, distance: 0, totalMs: DWELL_MS }
  const distance = overflow + FADE_PX
  const scrollMs = Math.round((distance / SCROLL_SPEED_PX_S) * 1000)
  // Nunca menos que o tempo padrão de uma campanha: o final fica parado o que faltar para completá-lo.
  const endMs = Math.max(END_PAUSE_MS, DWELL_MS - START_PAUSE_MS - scrollMs)
  return {
    animated: true,
    distance,
    startMs: START_PAUSE_MS,
    scrollMs,
    endMs,
    totalMs: START_PAUSE_MS + scrollMs + endMs,
  }
}

// Quadros-chave para Element.animate: parado, desliza em velocidade constante, parado.
export function marqueeKeyframes(timing) {
  const { distance, startMs, scrollMs, totalMs } = timing
  const to = `translate3d(${-distance}px, 0, 0)`
  return [
    { transform: 'translate3d(0, 0, 0)', offset: 0 },
    { transform: 'translate3d(0, 0, 0)', offset: startMs / totalMs },
    { transform: to, offset: (startMs + scrollMs) / totalMs },
    { transform: to, offset: 1 },
  ]
}

// Quanto falta para avançar depois de uma pausa: continua de onde a leitura parou (campanha animada) ou
// recomeça o tempo padrão (campanha que cabe).
export function remainingMs(timing, elapsedMs) {
  if (!timing.animated) return timing.totalMs
  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0
  return Math.max(0, timing.totalMs - elapsed)
}

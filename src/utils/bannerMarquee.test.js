import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DWELL_MS,
  END_PAUSE_MS,
  FADE_PX,
  MAX_DWELL_MS,
  MAX_SCROLL_SPEED_PX_S,
  SCROLL_SPEED_PX_S,
  START_PAUSE_MS,
  marqueeKeyframes,
  marqueeTiming,
  measureOverflow,
  remainingMs,
} from './bannerMarquee.js'

test('measureOverflow: cabe (inclusive subpixel) = 0; senão o excesso arredondado para cima', () => {
  assert.equal(measureOverflow(200, 200), 0)
  assert.equal(measureOverflow(200.4, 200), 0)
  assert.equal(measureOverflow(150, 200), 0)
  assert.equal(measureOverflow(260.2, 200), 61)
})

test('texto que cabe: sem animação e tempo padrão de rotação', () => {
  const timing = marqueeTiming(0)
  assert.equal(timing.animated, false)
  assert.equal(timing.totalMs, DWELL_MS)
  assert.equal(remainingMs(timing, 3000), DWELL_MS) // retomada recomeça o tempo padrão
})

test('texto longo: pausa, desliza tudo (inclui a faixa do degradê), pausa; nunca menos que o padrão', () => {
  const short = marqueeTiming(40)
  assert.equal(short.animated, true)
  assert.equal(short.distance, 40 + FADE_PX)
  assert.equal(short.startMs, START_PAUSE_MS)
  assert.ok(short.totalMs >= DWELL_MS)
  assert.equal(short.totalMs, short.startMs + short.scrollMs + short.endMs)

  const long = marqueeTiming(900)
  // 900px de excesso já cruza o teto de exposição (MAX_DWELL_MS) na velocidade confortável
  // (45px/s levaria a ~20s): a rolagem acelera até o teto de velocidade (90px/s) pra caber,
  // nunca é cortada -- a distância completa (900 + FADE_PX) ainda é percorrida por inteiro.
  assert.equal(long.scrollMs, Math.round(((900 + FADE_PX) / MAX_SCROLL_SPEED_PX_S) * 1000))
  assert.equal(long.endMs, END_PAUSE_MS) // texto muito longo: só a pausa mínima final
  assert.ok(long.totalMs > DWELL_MS)
  assert.ok(long.totalMs <= MAX_DWELL_MS, 'teto de exposição nunca é excedido')
  assert.ok(long.totalMs > long.startMs + long.scrollMs) // avança só DEPOIS da rolagem completa
})

test('teto de exposição: texto comprido demais pra velocidade confortável acelera, mas nunca corta a leitura', () => {
  // Abaixo do limiar que cruza o teto (distance <= (MAX_DWELL_MS-START_PAUSE_MS-END_PAUSE_MS)
  // em 45px/s): velocidade confortável de sempre, comportamento inalterado.
  const belowThreshold = marqueeTiming(300)
  assert.equal(belowThreshold.scrollMs, Math.round(((300 + FADE_PX) / SCROLL_SPEED_PX_S) * 1000))
  assert.ok(belowThreshold.totalMs <= MAX_DWELL_MS)

  // Um excesso moderado cabe com a velocidade preferida para textos longos.
  const near100CharTitle = marqueeTiming(900)
  assert.ok(near100CharTitle.totalMs <= MAX_DWELL_MS)
  const distance900 = 900 + FADE_PX
  const impliedSpeed900 = (distance900 / near100CharTitle.scrollMs) * 1000
  assert.equal(
    Math.round(impliedSpeed900),
    MAX_SCROLL_SPEED_PX_S,
    'excesso moderado rola à velocidade preferida, dentro do teto de exposição'
  )

  // Em uma tela estreita, até um título válido com glifos largos pode passar
  // do orçamento a 90px/s. O teto de exposição continua valendo.
  const widestValidTitle = marqueeTiming(1400)
  assert.equal(widestValidTitle.totalMs, MAX_DWELL_MS)
  assert.equal(widestValidTitle.scrollMs, MAX_DWELL_MS - START_PAUSE_MS - END_PAUSE_MS)

  // Para um excesso arbitrário, a rolagem ainda percorre a distância inteira,
  // mas o limite de tempo tem prioridade sobre a velocidade preferida.
  const pathological = marqueeTiming(5000)
  assert.equal(pathological.totalMs, MAX_DWELL_MS)
  assert.equal(pathological.distance, 5000 + FADE_PX)
})

test('quadros-chave: parado, desliza e termina parado no deslocamento total', () => {
  const timing = marqueeTiming(300)
  const frames = marqueeKeyframes(timing)
  assert.deepEqual(frames.map((f) => f.offset).slice(0, 1), [0])
  assert.equal(frames.at(-1).offset, 1)
  assert.equal(frames[0].transform, frames[1].transform)
  assert.equal(frames[2].transform, frames[3].transform)
  assert.equal(frames[2].transform, `translate3d(${-timing.distance}px, 0, 0)`)
  for (let i = 1; i < frames.length; i += 1) assert.ok(frames[i].offset >= frames[i - 1].offset)
  assert.ok(frames.every((f) => Object.keys(f).every((k) => k === 'transform' || k === 'offset')))
})

test('retomada de campanha animada continua de onde parou', () => {
  const timing = marqueeTiming(300)
  assert.equal(remainingMs(timing, 0), timing.totalMs)
  assert.equal(remainingMs(timing, 2500), timing.totalMs - 2500)
  assert.equal(remainingMs(timing, timing.totalMs + 50), 0)
  assert.equal(remainingMs(timing, NaN), timing.totalMs)
})

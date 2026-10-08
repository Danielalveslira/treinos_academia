import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLLAPSE_LIMIT_NARROW_PX,
  COLLAPSE_LIMIT_WIDE_PX,
  COLLAPSE_SLACK_PX,
  collapseLimitFor,
  pickCollapseHeight,
  planCollapse,
  shouldCollapse,
} from './collapseSnap.js'

test('limite maior em telas largas', () => {
  assert.equal(collapseLimitFor(320), COLLAPSE_LIMIT_NARROW_PX)
  assert.equal(collapseLimitFor(767), COLLAPSE_LIMIT_NARROW_PX)
  assert.equal(collapseLimitFor(768), COLLAPSE_LIMIT_WIDE_PX)
  assert.ok(COLLAPSE_LIMIT_NARROW_PX >= 700, 'bem mais que as ~3 linhas de um resumo')
})

test('publicações pequenas, médias e quase no limite aparecem inteiras (folga evita "Ver mais" de 2 linhas)', () => {
  assert.equal(shouldCollapse(180, 720), false)
  assert.equal(shouldCollapse(720, 720), false)
  assert.equal(shouldCollapse(720 + COLLAPSE_SLACK_PX, 720), false)
  assert.equal(shouldCollapse(720 + COLLAPSE_SLACK_PX + 1, 720), true)
})

test('corta no MAIOR ponto seguro que cabe no limite (nunca no meio de uma linha)', () => {
  // blocos/linhas terminam em 90, 210, 330 (linha de tabela), 468, 640, 790, 1200
  assert.equal(pickCollapseHeight([90, 210, 330, 468, 640, 790, 1200], 720), 640)
  assert.equal(pickCollapseHeight([640, 90, 468, 1200], 720), 640, 'a ordem não importa')
})

test('se nem o primeiro ponto cabe, mostra ao menos o primeiro pedaço inteiro', () => {
  assert.equal(pickCollapseHeight([900, 1100, 1500], 720), 900)
})

test('sem candidatos válidos cai no limite; valores inválidos são ignorados', () => {
  assert.equal(pickCollapseHeight([], 720), 720)
  assert.equal(pickCollapseHeight([NaN, -5, 0], 720), 720)
  assert.equal(pickCollapseHeight([NaN, 300], 720), 300)
})

test('planCollapse: null quando cabe; altura encaixada quando é extenso; null se economizar pouco', () => {
  assert.equal(planCollapse(600, [100, 600], 390), null)
  assert.equal(planCollapse(3000, [120, 400, 700, 1500, 3000], 390), 700)
  assert.equal(
    planCollapse(3000, [120, 400, 700, 1500, 3000], 1280),
    700,
    'em tela larga o limite é 880, o ponto seguro continua 700'
  )
  assert.equal(planCollapse(3000, [120, 400, 700, 850, 3000], 1280), 850)
  // economia menor que o mínimo: mostra tudo
  assert.equal(planCollapse(900, [100, 880, 900], 1280), null)
  assert.equal(planCollapse(Math.ceil(880 + COLLAPSE_SLACK_PX + 1), [100, 870], 1280), 870)
})

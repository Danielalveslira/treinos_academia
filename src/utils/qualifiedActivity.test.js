import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDayActivityComplete, saoPauloDayKey } from './qualifiedActivity.js'

test('só encerra o dia quando a recompensa saiu E o dia já qualificou', () => {
  assert.equal(isDayActivityComplete({ granted: true, dayQualified: true }), true)
  assert.equal(
    isDayActivityComplete({ granted: false, reason: 'already_granted', dayQualified: true }),
    true
  )
  assert.equal(isDayActivityComplete({ granted: true, dayQualified: false }), false)
  assert.equal(
    isDayActivityComplete({ granted: false, reason: 'already_granted', dayQualified: false }),
    false
  )
  assert.equal(
    isDayActivityComplete({ granted: false, reason: 'too_soon', dayQualified: true }),
    false
  )
})

test('resposta sem dayQualified nunca encerra o dia', () => {
  assert.equal(isDayActivityComplete({ granted: true }), false)
  assert.equal(isDayActivityComplete(null), false)
  assert.equal(isDayActivityComplete(undefined), false)
})

test('o dia vira à meia-noite de São Paulo, não à de UTC', () => {
  assert.equal(saoPauloDayKey(new Date('2026-10-03T02:59:00Z')), '2026-10-02')
  assert.equal(saoPauloDayKey(new Date('2026-10-03T03:00:00Z')), '2026-10-03')
})

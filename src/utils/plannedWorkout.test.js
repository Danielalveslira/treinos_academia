import test from 'node:test'
import assert from 'node:assert/strict'
import { plannedWorkoutNotice } from './plannedWorkout.js'

test('data planejada de hoje vira rótulo', () => {
  assert.equal(plannedWorkoutNotice('2026-10-05', '2026-10-05'), 'Treino planejado para hoje')
})

test('aviso antigo, futuro ou malformado abre o fluxo normal, sem rótulo', () => {
  assert.equal(plannedWorkoutNotice('2026-10-04', '2026-10-05'), null)
  assert.equal(plannedWorkoutNotice('2026-10-06', '2026-10-05'), null)
  for (const bad of [null, undefined, '', 'hoje', '2026-10-5', '2026-10-05<script>', '../2026-10-05']) {
    assert.equal(plannedWorkoutNotice(bad, '2026-10-05'), null)
  }
})

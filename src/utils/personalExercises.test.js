import test from 'node:test'
import assert from 'node:assert/strict'
import { canStartExercise, isLegacyExercise } from './personalExercises.js'

const official = {
  source: 'catalog',
  provider: 'evolutus_dataset',
  active: true,
  catalogAvailable: true,
}
test('new sessions use active official exercises, preserving last known offline availability', () => {
  assert.equal(canStartExercise(official), true)
  assert.equal(canStartExercise({ ...official, provider: 'evolutus_original' }), true)
  assert.equal(canStartExercise({ ...official, catalogAvailable: undefined }), true)
  for (const patch of [
    { source: 'custom' },
    { source: undefined },
    { active: false },
    { catalogAvailable: false },
    { provider: 'exerciseapi' },
  ]) {
    assert.equal(canStartExercise({ ...official, ...patch }), false)
  }
  assert.equal(canStartExercise(null), false)
  assert.equal(isLegacyExercise({ source: 'custom' }), true)
  assert.equal(isLegacyExercise({}), true)
  assert.equal(isLegacyExercise(official), false)
})

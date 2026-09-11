import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getExerciseType, isCardioExercise } from './exerciseType.js'

test('getExerciseType defaults absent/unknown values to strength (legacy exercises)', () => {
  assert.equal(getExerciseType({ type: 'cardio' }), 'cardio')
  assert.equal(getExerciseType({ type: 'strength' }), 'strength')
  assert.equal(getExerciseType({}), 'strength')
  assert.equal(getExerciseType(undefined), 'strength')
  assert.equal(getExerciseType({ type: 'yoga' }), 'strength')
})

test('isCardioExercise mirrors getExerciseType', () => {
  assert.equal(isCardioExercise({ type: 'cardio' }), true)
  assert.equal(isCardioExercise({ type: 'strength' }), false)
  assert.equal(isCardioExercise(undefined), false)
})

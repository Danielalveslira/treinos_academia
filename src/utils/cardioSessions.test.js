import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isCardioWorkout,
  isValidCardioSession,
  formatCardioSession,
  MAX_DURATION_MINUTES,
  MAX_DISTANCE_KM,
} from './cardioSessions.js'

test('isCardioWorkout checks the type field, nothing else', () => {
  assert.equal(isCardioWorkout({ type: 'cardio' }), true)
  assert.equal(isCardioWorkout({ type: 'strength' }), false)
  assert.equal(isCardioWorkout({}), false)
  assert.equal(isCardioWorkout(undefined), false)
})

test('isValidCardioSession requires duration in range; distance is optional but bounded when given', () => {
  assert.equal(isValidCardioSession({ durationMinutes: 30 }), true)
  assert.equal(isValidCardioSession({ durationMinutes: 30, distanceKm: 5 }), true)
  assert.equal(isValidCardioSession({ durationMinutes: 30, distanceKm: '' }), true)
  assert.equal(isValidCardioSession({ durationMinutes: 30, distanceKm: null }), true)
  assert.equal(isValidCardioSession({ durationMinutes: 0 }), false)
  assert.equal(isValidCardioSession({ durationMinutes: MAX_DURATION_MINUTES + 1 }), false)
  assert.equal(isValidCardioSession({ durationMinutes: MAX_DURATION_MINUTES }), true)
  assert.equal(isValidCardioSession({ durationMinutes: '' }), false)
  assert.equal(isValidCardioSession({}), false)
  assert.equal(isValidCardioSession({ durationMinutes: 30, distanceKm: 0 }), false)
  assert.equal(
    isValidCardioSession({ durationMinutes: 30, distanceKm: MAX_DISTANCE_KM + 1 }),
    false
  )
  assert.equal(isValidCardioSession({ durationMinutes: 30, distanceKm: 'abc' }), false)
  // strings numéricas (o que vem de um <input type="number">) também são aceitas.
  assert.equal(isValidCardioSession({ durationMinutes: '30', distanceKm: '5.2' }), true)
})

test('formatCardioSession shows duration alone or with distance', () => {
  assert.equal(formatCardioSession({ durationMinutes: 32 }), '32 min')
  assert.equal(formatCardioSession({ durationMinutes: 32, distanceKm: 5.2 }), '32 min · 5,2 km')
})

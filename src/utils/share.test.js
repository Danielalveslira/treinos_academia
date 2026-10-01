import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCommunityLink,
  buildShareText,
  buildWorkoutLink,
  canShareNatively,
  workoutIdFromHash,
} from './share.js'

test('buildCommunityLink points to the public community route, nothing else', () => {
  assert.equal(
    buildCommunityLink('gym', 'https://app.example.com'),
    'https://app.example.com/comunidades/gym'
  )
})

test('buildShareText embeds only the app name and the community link', () => {
  const text = buildShareText('gym', 'https://app.example.com')
  assert.match(text, /Evolutus/)
  assert.match(text, /https:\/\/app\.example\.com\/comunidades\/gym/)
  assert.doesNotMatch(text, /statuses\/|token/i)
})

test('workout sharing points directly to the workout card without exposing internal data paths', () => {
  const status = {
    id: 'workout-123',
    type: 'workout',
    workout: { title: 'Treino de pernas' },
  }
  assert.equal(
    buildWorkoutLink('gym', status.id, 'https://app.example.com'),
    'https://app.example.com/comunidades/gym#treino-workout-123'
  )
  const text = buildShareText('gym', 'https://app.example.com', status)
  assert.match(text, /Treino de pernas/)
  assert.match(text, /#treino-workout-123/)
  assert.doesNotMatch(text, /statuses\//i)
})

test('workoutIdFromHash accepts only a safe workout anchor', () => {
  assert.equal(workoutIdFromHash('#treino-workout_123'), 'workout_123')
  assert.equal(workoutIdFromHash('#treino-workout%2F123'), null)
  assert.equal(workoutIdFromHash('#outro-workout_123'), null)
  assert.equal(workoutIdFromHash('#treino-'), null)
})

test('canShareNatively reflects navigator.share availability', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { share: () => {} }, configurable: true })
  assert.equal(canShareNatively(), true)
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
  assert.equal(canShareNatively(), false)
  if (original) Object.defineProperty(globalThis, 'navigator', original)
})

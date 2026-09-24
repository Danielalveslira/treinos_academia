import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fitDimensions,
  validateImageFile,
  ALLOWED_INPUT_TYPES,
  MAX_INPUT_BYTES,
} from './imageCompression.js'

test('fitDimensions keeps images under the max dimension untouched', () => {
  assert.deepEqual(fitDimensions(800, 600), { width: 800, height: 600 })
})

test('fitDimensions downscales proportionally to the longest side', () => {
  assert.deepEqual(fitDimensions(3200, 1600), { width: 1600, height: 800 })
  assert.deepEqual(fitDimensions(1600, 3200), { width: 800, height: 1600 })
})

test('fitDimensions accepts a smaller custom max, as profileAvatarService uses for avatars', () => {
  assert.deepEqual(fitDimensions(1600, 1600, 320), { width: 320, height: 320 })
  assert.deepEqual(fitDimensions(200, 100, 320), { width: 200, height: 100 })
})

test('validateImageFile rejects missing files, disallowed types and oversized files', () => {
  assert.match(validateImageFile(null), /selecione/i)
  assert.match(validateImageFile({ type: 'application/pdf', size: 100 }), /formato/i)
  assert.match(validateImageFile({ type: 'image/jpeg', size: MAX_INPUT_BYTES + 1 }), /menor/i)
  for (const type of ALLOWED_INPUT_TYPES) {
    assert.equal(validateImageFile({ type, size: 1024 }), null)
  }
})

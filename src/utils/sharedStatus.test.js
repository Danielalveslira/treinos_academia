import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStatusLoaded } from './sharedStatus.js'

test('isStatusLoaded finds the publication in any loaded list', () => {
  assert.equal(isStatusLoaded('a', [{ id: 'a' }], [], []), true)
  assert.equal(isStatusLoaded('b', [{ id: 'a' }], [{ id: 'b' }], []), true)
  assert.equal(isStatusLoaded('c', [], [], [{ id: 'c', type: 'workout' }]), true)
})

test('isStatusLoaded is false when the publication is outside the loaded pages', () => {
  assert.equal(isStatusLoaded('z', [{ id: 'a' }], [{ id: 'b' }], []), false)
  assert.equal(isStatusLoaded('z'), false)
  assert.equal(isStatusLoaded('z', undefined, null, []), false)
})

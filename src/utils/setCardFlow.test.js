import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextActiveSetIndexAfterRemoval } from './setCardFlow.js'

test('removing a set from the middle keeps the same index -- the next set slides into place', () => {
  assert.equal(nextActiveSetIndexAfterRemoval(1, 3), 1)
})

test('removing the first set (not the last) keeps index 0', () => {
  assert.equal(nextActiveSetIndexAfterRemoval(0, 3), 0)
})

test('removing the last set steps back one position', () => {
  assert.equal(nextActiveSetIndexAfterRemoval(2, 3), 1)
})

test('removing the last set when it is also the second one steps back to the first', () => {
  assert.equal(nextActiveSetIndexAfterRemoval(1, 2), 0)
})

test('edge case: removing the only remaining set clamps to 0, never negative', () => {
  assert.equal(nextActiveSetIndexAfterRemoval(0, 1), 0)
})

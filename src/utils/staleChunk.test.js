import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStaleChunkError } from './staleChunk.js'

test('isStaleChunkError recognizes a deleted lazy-chunk failure, not any other error', () => {
  assert.equal(isStaleChunkError(Object.assign(new Error('boom'), { name: 'ChunkLoadError' })), true)
  assert.equal(
    isStaleChunkError(new Error('Failed to fetch dynamically imported module: /assets/Foo.js')),
    true
  )
  assert.equal(
    isStaleChunkError(new Error('error loading dynamically imported module: /assets/Foo.js')),
    true
  )
  assert.equal(isStaleChunkError(new TypeError('Importing a module script failed')), true)
  assert.equal(isStaleChunkError(new TypeError("Cannot read properties of null (reading 'x')")), false)
  assert.equal(isStaleChunkError(new Error('network error')), false)
  assert.equal(isStaleChunkError(null), false)
  assert.equal(isStaleChunkError(undefined), false)
})

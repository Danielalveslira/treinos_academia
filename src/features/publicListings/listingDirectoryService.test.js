import { test } from 'node:test'
import assert from 'node:assert/strict'
import { remainingLeaseMs, directoryPath } from './listingDirectoryService.js'
test('lease uses server duration and elapsed IO instead of the device clock', () => {
  assert.equal(
    remainingLeaseMs(
      { serverTime: '2026-10-28T00:00:00Z', expiresAt: '2026-10-28T00:00:10Z' },
      2500
    ),
    7500
  )
  assert.equal(remainingLeaseMs({ serverTime: 'invalid', expiresAt: '2035-01-01' }), 0)
  assert.equal(
    remainingLeaseMs(
      { serverTime: '2026-10-28T00:00:00Z', validUntil: '2026-10-28T00:00:01Z' },
      2000
    ),
    -1000
  )
})
test('both public kinds keep distinct stable directory paths', () => {
  assert.equal(directoryPath('professional'), '/profissionais')
  assert.equal(directoryPath('space'), '/locais')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refundDate, refundError, withdrawalRemaining, refundCategories } from './refunds.js'
test('guidance uses Brasilia rather than browser timezone', () => {
  assert.match(refundDate('2026-10-30T01:30:00Z'), /29\/10\/2026.*22:30.*Brasília/)
})
test('monotonic elapsed time only shortens server authorization', () => {
  const source = { deadlineAt: '2026-10-30T00:00:00Z', serverNow: '2026-10-29T23:59:00Z' }
  assert.equal(withdrawalRemaining(source, 100, 10100), 50000)
  assert.equal(withdrawalRemaining(source, 100, 60101), 0)
  assert.equal(withdrawalRemaining(source, 100, 90), 60000)
})
test('window error preserves other legal complaint channels', () => {
  assert.match(
    refundError(new Error('WITHDRAWAL_WINDOW_CLOSED_USE_COMPLAINT')),
    /continuam disponíveis/
  )
  assert.ok(refundCategories.service_failure)
  assert.ok(refundCategories.duplicate_payment)
})

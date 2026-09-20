import { test } from 'node:test'
import assert from 'node:assert/strict'
import { derivePromotionStatus } from './promotionStatus.js'

function fakeTimestamp(ms) {
  return { toMillis: () => ms }
}

test('derivePromotionStatus: cancelled and target_removed win regardless of expiresAt', () => {
  assert.equal(derivePromotionStatus({ status: 'cancelled', expiresAt: fakeTimestamp(5000) }, 1000), 'cancelled')
  assert.equal(
    derivePromotionStatus({ status: 'target_removed', expiresAt: fakeTimestamp(5000) }, 1000),
    'target_removed'
  )
})

test('derivePromotionStatus: active status is "active" only while expiresAt is in the future', () => {
  assert.equal(derivePromotionStatus({ status: 'active', expiresAt: fakeTimestamp(2000) }, 1000), 'active')
})

test('derivePromotionStatus: active status past expiresAt derives to "expired", never trusted alone', () => {
  assert.equal(derivePromotionStatus({ status: 'active', expiresAt: fakeTimestamp(500) }, 1000), 'expired')
})

test('derivePromotionStatus: boundary at exactly expiresAt is already expired (strictly greater-than)', () => {
  assert.equal(derivePromotionStatus({ status: 'active', expiresAt: fakeTimestamp(1000) }, 1000), 'expired')
})

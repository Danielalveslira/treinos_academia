import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toMillis, formatTimeRemaining } from './expiry.js'

test('formatTimeRemaining shows hours+minutes above 1h and minutes only below', () => {
  assert.equal(formatTimeRemaining(18 * 3600000 + 42 * 60000), 'Expira em 18h 42min')
  assert.equal(formatTimeRemaining(3 * 3600000 + 15 * 60000), 'Expira em 3h 15min')
  assert.equal(formatTimeRemaining(27 * 60000), 'Expira em 27min')
})

test('formatTimeRemaining never shows 0min while still counting and hides once expired', () => {
  assert.equal(formatTimeRemaining(30000), 'Expira em 1min')
  assert.equal(formatTimeRemaining(0), null)
  assert.equal(formatTimeRemaining(-1000), null)
})

test('toMillis reads Firestore Timestamp, Date and raw values', () => {
  const asDate = new Date('2026-09-09T12:00:00Z')
  assert.equal(toMillis(asDate), asDate.getTime())
  assert.equal(toMillis({ toMillis: () => 123 }), 123)
  assert.equal(toMillis({ toDate: () => asDate }), asDate.getTime())
  assert.equal(toMillis(null), 0)
})

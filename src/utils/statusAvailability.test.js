import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectivePublicationExpiry, isPublicationInteractionActive } from './statusAvailability.js'

test('a valid promotion extends the effective publication window', () => {
  const now = Date.now()
  const status = {
    expiresAt: new Date(now - 1_000),
    promoted: true,
    promotedUntil: new Date(now + 60_000),
  }
  assert.equal(effectivePublicationExpiry(status), now + 60_000)
  assert.equal(isPublicationInteractionActive(status, now), true)
})

test('an ended or unmarked promotion does not keep interactions active', () => {
  const now = Date.now()
  const base = {
    expiresAt: new Date(now - 2_000),
    promotedUntil: new Date(now - 1_000),
  }
  assert.equal(isPublicationInteractionActive({ ...base, promoted: true }, now), false)
  assert.equal(
    isPublicationInteractionActive(
      { ...base, promoted: false, promotedUntil: new Date(now + 60_000) },
      now
    ),
    false
  )
})

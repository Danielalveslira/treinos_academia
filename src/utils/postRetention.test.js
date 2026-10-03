import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expiresAtForRetention, isNeverExpiring } from './postRetention.js'
import { effectivePublicationExpiry, isPublicationInteractionActive } from './statusAvailability.js'

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0)

test('24h, 30d e sem expiração', () => {
  assert.equal(expiresAtForRetention('24h', NOW).getTime(), NOW + 24 * 3600 * 1000)
  assert.equal(expiresAtForRetention('30d', NOW).getTime(), NOW + 30 * 24 * 3600 * 1000)
  assert.equal(expiresAtForRetention('no_auto_expiration', NOW), null)
})

test('modo desconhecido cai em 24h (comportamento histórico), nunca em "eterno"', () => {
  assert.equal(expiresAtForRetention('weird', NOW).getTime(), NOW + 24 * 3600 * 1000)
  assert.equal(expiresAtForRetention(undefined, NOW).getTime(), NOW + 24 * 3600 * 1000)
})

test('sem expiração só quando o post declara isso', () => {
  assert.equal(isNeverExpiring({ retentionMode: 'no_auto_expiration', expiresAt: null }), true)
  assert.equal(isNeverExpiring({ retentionMode: '24h', expiresAt: null }), false)
  assert.equal(isNeverExpiring({ expiresAt: null }), false)
  assert.equal(
    isNeverExpiring({ retentionMode: 'no_auto_expiration', expiresAt: new Date(NOW) }),
    false
  )
})

test('post sem expiração continua interativo; sem declarar a regra, expiresAt nulo segue como expirado', () => {
  const never = { retentionMode: 'no_auto_expiration', expiresAt: null, commentsCloseAt: null }
  assert.equal(effectivePublicationExpiry(never), Infinity)
  assert.equal(isPublicationInteractionActive(never, NOW), true)
  assert.equal(
    isPublicationInteractionActive({ expiresAt: null, commentsCloseAt: null }, NOW),
    false
  )
})

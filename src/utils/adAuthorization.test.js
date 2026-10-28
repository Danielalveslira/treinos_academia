import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adAuthorizationDeadline,
  authorizedAds,
  nextAuthorizationDeadline,
} from './adAuthorization.js'
test('server time produces a conservative deadline independent of the device date', () => {
  const deadline = adAuthorizationDeadline('2026-10-29T12:00:00Z', '2026-10-28T12:00:00Z', 100)
  assert.equal(deadline, 86400100)
  assert.equal(authorizedAds([{ id: 'paid', authorizationUntil: deadline }], deadline).length, 0)
  assert.equal(
    authorizedAds([{ id: 'paid', authorizationUntil: deadline }], deadline - 1).length,
    1
  )
})
test('missing server timestamps fail closed for expiring rows', () => {
  assert.equal(adAuthorizationDeadline('2026-10-29T12:00:00Z', undefined, 100), 100)
  assert.equal(adAuthorizationDeadline(null, undefined, 100), Infinity)
})
test('the nearest timer removes only expired ads and can retain legacy nonexpiring rows', () => {
  const ads = [
    { id: 'a', authorizationUntil: 100 },
    { id: 'b', authorizationUntil: 200 },
    { id: 'legacy', authorizationUntil: Infinity },
  ]
  assert.equal(nextAuthorizationDeadline(ads), 100)
  assert.deepEqual(
    authorizedAds(ads, 100).map((a) => a.id),
    ['b', 'legacy']
  )
  assert.equal(nextAuthorizationDeadline(authorizedAds(ads, 200)), null)
})

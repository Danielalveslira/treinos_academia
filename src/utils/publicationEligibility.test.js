import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eligiblePublications, isPublicationEligible } from './publicationEligibility.js'

const now = Date.parse('2026-10-13T12:00:00Z')
const past = '2026-10-12T12:00:00Z'
const future = '2026-10-16T12:00:00Z'

test('elegibilidade segue exatamente prazo efetivo da view, sem usar flags nem prazo de interação', () => {
  for (const [status, expected] of [
    [{ expiresAt: past, publicationExpiresAt: future }, true],
    [{ expiresAt: future, publicationExpiresAt: future }, true],
    [{ expiresAt: past, publicationExpiresAt: null }, true],
    [{ expiresAt: null, publicationExpiresAt: null }, true],
    [{ expiresAt: past, publicationExpiresAt: past, promoted: true, promotedUntil: future }, false],
    [{ expiresAt: past, publicationExpiresAt: past, commentsCloseAt: future }, false],
    [{ expiresAt: future, publicationExpiresAt: past }, false],
    [{ publicationExpiresAt: new Date(now).toISOString() }, false],
    [{ publicationExpiresAt: undefined }, false],
    [{ publicationExpiresAt: 'inválido' }, false],
    [{ expiresAt: future }, true],
    [{ expiresAt: past, promoted: true, promotedUntil: future }, false],
    [{ expiresAt: null, retentionMode: 'no_auto_expiration' }, true],
    [{}, false],
  ])
    assert.equal(isPublicationEligible(status, now), expected, JSON.stringify(status))
})

test('não altera referência quando nada expirou e remove vencidos mantendo ordem', () => {
  const live = { id: 'live', publicationExpiresAt: future }
  const permanent = { id: 'permanent', publicationExpiresAt: null }
  const expired = { id: 'expired', publicationExpiresAt: past }
  const items = [live, permanent]
  assert.equal(eligiblePublications(items, now), items)
  assert.deepEqual(eligiblePublications([live, expired, permanent], now), items)
})

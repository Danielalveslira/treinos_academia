import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hasCurrentShowcaseAcknowledgement,
  shouldShowShowcaseTermsBanner,
  SHOWCASE_LEGAL_MANIFEST,
} from './showcaseLegal.js'

const policy = {
  documentId: SHOWCASE_LEGAL_MANIFEST.documentId,
  version: '1.1.0',
  published: true,
}

test('acknowledgement requires the currently published version and a server timestamp', () => {
  const current = { version: policy.version, acknowledgedAt: '2026-10-01T00:00:00Z' }
  assert.equal(hasCurrentShowcaseAcknowledgement(current, policy), true)
  assert.equal(hasCurrentShowcaseAcknowledgement({ ...current, version: '1.0.0' }, policy), false)
  assert.equal(hasCurrentShowcaseAcknowledgement({ ...current, acknowledgedAt: null }, policy), false)
  assert.equal(hasCurrentShowcaseAcknowledgement(null, policy), false)
})

test('no banner when the server has no published showcase policy yet', () => {
  assert.equal(
    shouldShowShowcaseTermsBanner({ policy: { published: false, version: null }, acknowledgement: null }),
    false
  )
})

test('banner shows for a published version the user never acknowledged -- never a gate', () => {
  assert.equal(shouldShowShowcaseTermsBanner({ policy, acknowledgement: null }), true)
  assert.equal(
    shouldShowShowcaseTermsBanner({
      policy,
      acknowledgement: { version: '1.0.0', acknowledgedAt: '2026-09-01T00:00:00Z' },
    }),
    true
  )
})

test('banner hides once the current version is acknowledged, reappears on a newer one', () => {
  const acknowledgement = { version: policy.version, acknowledgedAt: '2026-10-01T00:00:00Z' }
  assert.equal(shouldShowShowcaseTermsBanner({ policy, acknowledgement }), false)
  const nextPolicy = { ...policy, version: '1.2.0' }
  assert.equal(shouldShowShowcaseTermsBanner({ policy: nextPolicy, acknowledgement }), true)
})

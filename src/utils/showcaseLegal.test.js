import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canSubmitShowcaseListing,
  hasCurrentShowcaseAcceptance,
  SHOWCASE_LEGAL_MANIFEST,
} from './showcaseLegal.js'

test('storefront acceptance requires this document, current version and a server timestamp', () => {
  const current = {
    documentId: SHOWCASE_LEGAL_MANIFEST.documentId,
    version: SHOWCASE_LEGAL_MANIFEST.version,
    acceptedAt: { seconds: 1 },
  }
  assert.equal(hasCurrentShowcaseAcceptance(current), true)
  assert.equal(hasCurrentShowcaseAcceptance({ ...current, version: '0.9.0' }), false)
  assert.equal(hasCurrentShowcaseAcceptance({ ...current, documentId: 'terms' }), false)
  assert.equal(hasCurrentShowcaseAcceptance({ ...current, acceptedAt: null }), false)
})

test('unpublished storefront terms always block submission', () => {
  assert.equal(
    canSubmitShowcaseListing({
      acceptance: null,
      confirmed: true,
      manifest: { ...SHOWCASE_LEGAL_MANIFEST, published: false },
    }),
    false
  )
})

test('published storefront terms require confirmation or a current recorded acceptance', () => {
  // Não depende do estado atual (publicado ou minuta) do documento real -- só do
  // comportamento de canSubmitShowcaseListing quando published é true.
  const manifest = { ...SHOWCASE_LEGAL_MANIFEST, published: true }
  assert.equal(canSubmitShowcaseListing({ acceptance: null, confirmed: false, manifest }), false)
  assert.equal(canSubmitShowcaseListing({ acceptance: null, confirmed: true, manifest }), true)
  assert.equal(
    canSubmitShowcaseListing({
      acceptance: {
        documentId: manifest.documentId,
        version: manifest.version,
        acceptedAt: { seconds: 1 },
      },
      confirmed: false,
      manifest,
    }),
    true
  )
})

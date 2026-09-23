import test from 'node:test'
import assert from 'node:assert/strict'
import {
  listingFilterKey,
  normalizeListingFilter,
  safeExternalContact,
} from './professionalListing.js'

test('listing filters normalize city accents and preserve every selected dimension', () => {
  assert.equal(normalizeListingFilter('  São  José  '), 'sao jose')
  assert.equal(
    listingFilterKey({
      kind: 'professional',
      modality: 'corrida',
      uf: 'SP',
      city: 'São José',
      serviceMode: 'hybrid',
    }),
    'professional|corrida|SP|sao jose|hybrid'
  )
})

test('external contacts accept only the expected HTTPS destinations', () => {
  assert.equal(safeExternalContact({ type: 'website', url: 'javascript:alert(1)' }), null)
  assert.equal(
    safeExternalContact({ type: 'whatsapp', url: 'https://evil.example/55119999' }),
    null
  )
  assert.equal(
    safeExternalContact({ type: 'instagram', url: 'https://instagram.com/evolutus' }).type,
    'instagram'
  )
  assert.equal(
    safeExternalContact({ type: 'website', url: 'https://example.com/path' }).url,
    'https://example.com/path'
  )
})

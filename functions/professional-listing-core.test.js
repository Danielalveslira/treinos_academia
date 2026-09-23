import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFilterKeys,
  buildPublicProjection,
  validateListingDraft,
} from './professional-listing-core.js'

const validDraft = {
  kind: 'professional',
  displayName: 'Ana Treinadora',
  categoryKey: 'personal_trainer',
  modalityKeys: ['musculacao', 'corrida'],
  specialties: ['Hipertrofia'],
  bio: 'Treinos individualizados.',
  city: 'São Paulo',
  uf: 'SP',
  serviceMode: 'hybrid',
  contacts: {
    whatsapp: 'https://wa.me/5511999999999',
    instagram: '',
    website: 'https://example.com',
  },
  useProfileAvatar: true,
}

test('validates and sanitizes the complete V1 draft', () => {
  const result = validateListingDraft(validDraft)
  assert.equal(result.error, undefined)
  assert.equal(result.value.cityKey, 'sao paulo')
  assert.equal(result.value.contacts.website, 'https://example.com/')
})

test('rejects unsafe contact protocols and excessive modalities', () => {
  assert.match(
    validateListingDraft({ ...validDraft, contacts: { website: 'javascript:alert(1)' } }).error,
    /HTTPS/
  )
  assert.match(
    validateListingDraft({
      ...validDraft,
      modalityKeys: ['musculacao', 'corrida', 'yoga', 'pilates', 'lutas', 'danca'],
    }).error,
    /cinco/
  )
})

test('filter keys cover exact and wildcard combinations without exceeding the documented cap', () => {
  const parsed = validateListingDraft(validDraft).value
  const keys = buildFilterKeys(parsed)
  assert.equal(keys.length, 24)
  assert.ok(keys.includes('professional|corrida|SP|sao paulo|hybrid'))
  assert.ok(keys.includes('professional|*|*|*|*'))
  assert.ok(keys.length <= 80)
})

test('public projection exposes no owner, moderation or private fields', () => {
  const projection = buildPublicProjection(validateListingDraft(validDraft).value, {
    avatarPath: 'approved/avatar.webp',
    avatarSourceMediaId: 'media',
  })
  assert.equal(projection.ownerId, undefined)
  assert.equal(projection.contacts, undefined)
  assert.deepEqual(
    projection.publicContacts.map((item) => item.type),
    ['whatsapp', 'website']
  )
  assert.equal(projection.publicationStatus, 'published')
})

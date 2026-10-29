import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveStorefrontStatus } from './storefrontStatus.js'

const NOW = new Date('2026-12-10T12:00:00Z').getTime()
const base = {
  editorialState: 'draft',
  draftState: 'draft',
  publicationState: 'private',
  hasPublishedVersion: false,
  expiresAt: null,
}

test('draft never approved shows Rascunho', () => {
  const s = deriveStorefrontStatus(base, { now: NOW })
  assert.equal(s.key, 'draft')
  assert.equal(s.primaryAction.type, 'edit')
})

test('submitted never approved shows Em análise', () => {
  const s = deriveStorefrontStatus({ ...base, draftState: 'submitted' }, { now: NOW })
  assert.equal(s.key, 'submitted')
})

test('rejected never approved shows Reprovada', () => {
  const s = deriveStorefrontStatus(
    { ...base, draftState: 'rejected', lastDecision: 'Descrição incompleta' },
    { now: NOW }
  )
  assert.equal(s.key, 'rejected')
  assert.equal(s.detail, 'Descrição incompleta')
})

test('editorial suspension always wins', () => {
  const s = deriveStorefrontStatus(
    { ...base, editorialState: 'suspended', hasPublishedVersion: true, expiresAt: '2027-01-01T00:00:00Z' },
    { now: NOW }
  )
  assert.equal(s.key, 'suspended')
})

test('entitlement-level suspended/revoked also reads as Suspensa, not Publicada', () => {
  const suspended = deriveStorefrontStatus(
    { ...base, editorialState: 'approved', draftState: 'approved', hasPublishedVersion: true, publicationState: 'suspended', expiresAt: '2027-01-01T00:00:00Z' },
    { now: NOW }
  )
  assert.equal(suspended.key, 'suspended')
  const revoked = deriveStorefrontStatus(
    { ...base, editorialState: 'approved', draftState: 'approved', hasPublishedVersion: true, publicationState: 'revoked', expiresAt: '2027-01-01T00:00:00Z' },
    { now: NOW }
  )
  assert.equal(revoked.key, 'suspended')
})

test('archived always wins even if editorially approved', () => {
  const s = deriveStorefrontStatus({ ...base, editorialState: 'archived', hasPublishedVersion: true }, { now: NOW })
  assert.equal(s.key, 'archived')
})

test('approved with no entitlement yet is "aguardando contratação", never implies publication', () => {
  const s = deriveStorefrontStatus(
    { ...base, editorialState: 'approved', draftState: 'approved', hasPublishedVersion: true },
    { now: NOW }
  )
  assert.equal(s.key, 'approved_unpaid')
  assert.equal(s.label, 'Aprovada — aguardando contratação')
})

test('approved + active entitlement is Publicada, with a real "Ver minha vitrine" action', () => {
  const s = deriveStorefrontStatus(
    {
      ...base,
      editorialState: 'approved',
      draftState: 'approved',
      hasPublishedVersion: true,
      publicationState: 'active',
      expiresAt: '2026-12-20T00:00:00Z',
    },
    { now: NOW }
  )
  assert.equal(s.key, 'live')
  assert.equal(s.label, 'Publicada')
  assert.equal(s.primaryAction.type, 'view')
})

test('expired entitlement is "Encerrada em [data]"', () => {
  const s = deriveStorefrontStatus(
    {
      ...base,
      editorialState: 'approved',
      draftState: 'approved',
      hasPublishedVersion: true,
      publicationState: 'expired',
      expiresAt: '2026-12-01T00:00:00Z',
    },
    { now: NOW }
  )
  assert.equal(s.key, 'ended')
  assert.match(s.label, /^Encerrada em /)
})

test('a published storefront with a newer revision pending review keeps Publicada and surfaces a note', () => {
  const s = deriveStorefrontStatus(
    {
      ...base,
      editorialState: 'approved',
      draftState: 'submitted',
      hasPublishedVersion: true,
      publicationState: 'active',
      expiresAt: '2026-12-20T00:00:00Z',
    },
    { now: NOW }
  )
  assert.equal(s.key, 'live')
  assert.equal(s.pendingRevision, true)
  assert.match(s.label, /Publicada — atualização em análise/)
})

test('a published storefront whose latest revision was rejected keeps serving the approved one', () => {
  const s = deriveStorefrontStatus(
    {
      ...base,
      editorialState: 'approved',
      draftState: 'rejected',
      lastDecision: 'Produto incompleto',
      hasPublishedVersion: true,
      publicationState: 'active',
      expiresAt: '2026-12-20T00:00:00Z',
    },
    { now: NOW }
  )
  assert.equal(s.key, 'live')
  assert.equal(s.pendingRevision, true)
  assert.match(s.pendingRevisionNote, /Produto incompleto/)
  assert.equal(s.primaryAction.type, 'edit')
})

test('an incomplete legacy row never throws', () => {
  const s = deriveStorefrontStatus({ editorialState: 'approved', draftState: 'approved', hasPublishedVersion: true }, { now: NOW })
  assert.equal(s.key, 'approved_unpaid')
})

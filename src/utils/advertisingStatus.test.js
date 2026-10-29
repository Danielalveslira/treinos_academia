import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveAdStatus } from './advertisingStatus.js'

const NOW = new Date('2026-12-10T12:00:00Z').getTime()
const base = {
  moderation_state: 'draft',
  state: 'draft',
  expires_at: null,
  starts_at: null,
  can_pay: true,
  delivery_state: 'private',
  placement_delivery_active: null,
  tariff: { salesEnabled: true },
}

test('draft never approved shows Rascunho with edit action', () => {
  const s = deriveAdStatus(base, { now: NOW })
  assert.equal(s.key, 'draft')
  assert.equal(s.label, 'Rascunho')
  assert.equal(s.primaryAction.type, 'edit')
})

test('submitted never approved shows Em análise', () => {
  const s = deriveAdStatus({ ...base, state: 'submitted' }, { now: NOW })
  assert.equal(s.key, 'submitted')
  assert.equal(s.label, 'Em análise')
})

test('rejected never approved shows Reprovado with the review reason', () => {
  const s = deriveAdStatus(
    { ...base, state: 'rejected', review_reason: 'Imagem não condiz com o destino' },
    { now: NOW }
  )
  assert.equal(s.key, 'rejected')
  assert.equal(s.detail, 'Imagem não condiz com o destino')
})

test('suspended always wins regardless of delivery or contract state', () => {
  const s = deriveAdStatus(
    { ...base, moderation_state: 'suspended', state: 'approved', expires_at: '2027-01-01T00:00:00Z' },
    { now: NOW }
  )
  assert.equal(s.key, 'paused')
})

test('archived always wins even if moderation_state is still approved', () => {
  const s = deriveAdStatus({ ...base, moderation_state: 'archived', state: 'archived' }, { now: NOW })
  assert.equal(s.key, 'archived')
})

test('approved without any entitlement never implies a contract exists (can_pay is permission, not proof)', () => {
  const s = deriveAdStatus(
    { ...base, moderation_state: 'approved', state: 'approved', can_pay: false },
    { now: NOW }
  )
  assert.equal(s.key, 'approved_unpaid')
  assert.equal(s.label, 'Aprovado — aguardando contratação')
})

test('sales disabled never shows a contracting CTA, even to the account owner (can_pay=true)', () => {
  const unpaid = deriveAdStatus(
    { ...base, moderation_state: 'approved', state: 'approved', can_pay: true, tariff: { salesEnabled: false } },
    { now: NOW }
  )
  assert.equal(unpaid.primaryAction.type, 'wait')
  assert.notEqual(unpaid.primaryAction.type, 'contract')

  const ended = deriveAdStatus(
    {
      ...base,
      moderation_state: 'approved',
      state: 'approved',
      can_pay: true,
      tariff: { salesEnabled: false },
      starts_at: '2026-11-01T00:00:00Z',
      expires_at: '2026-12-01T00:00:00Z',
      delivery_state: 'expired',
    },
    { now: NOW }
  )
  assert.equal(ended.key, 'ended')
  assert.equal(ended.primaryAction.type, 'wait', '"Renovar" must not be offered while sales are off')
})

test('approved with an entitlement that has not started yet is "aguardando início", not "No ar"', () => {
  const s = deriveAdStatus(
    {
      ...base,
      moderation_state: 'approved',
      state: 'approved',
      starts_at: '2026-12-15T00:00:00Z',
      expires_at: '2026-12-20T00:00:00Z',
      delivery_state: 'private',
    },
    { now: NOW }
  )
  assert.equal(s.key, 'contracted_pending_start')
})

test('"No ar" (live) requires delivery_state active AND the consolidated placement signal', () => {
  const live = deriveAdStatus(
    {
      ...base,
      moderation_state: 'approved',
      state: 'approved',
      starts_at: '2026-12-01T00:00:00Z',
      expires_at: '2026-12-20T00:00:00Z',
      delivery_state: 'active',
      placement_delivery_active: true,
    },
    { now: NOW }
  )
  assert.equal(live.key, 'live')
  assert.equal(live.label, 'Apto para exibição')

  const notReallyLive = deriveAdStatus(
    {
      ...base,
      moderation_state: 'approved',
      state: 'approved',
      starts_at: '2026-12-01T00:00:00Z',
      expires_at: '2026-12-20T00:00:00Z',
      delivery_state: 'active',
      placement_delivery_active: false,
    },
    { now: NOW }
  )
  assert.notEqual(notReallyLive.key, 'live')
  assert.doesNotMatch(notReallyLive.label, /No ar|Apto para exibição/)
})

test('expired entitlement is "Encerrado em [data]", never "No ar"', () => {
  const s = deriveAdStatus(
    {
      ...base,
      moderation_state: 'approved',
      state: 'approved',
      starts_at: '2026-11-01T00:00:00Z',
      expires_at: '2026-12-01T00:00:00Z',
      delivery_state: 'expired',
    },
    { now: NOW }
  )
  assert.equal(s.key, 'ended')
  assert.match(s.label, /^Encerrado em /)
})

test('administratively blocked entitlement never claims "No ar"', () => {
  const s = deriveAdStatus(
    {
      ...base,
      moderation_state: 'approved',
      state: 'approved',
      starts_at: '2026-12-01T00:00:00Z',
      expires_at: '2026-12-20T00:00:00Z',
      delivery_state: 'private',
      placement_delivery_active: null,
    },
    { now: NOW }
  )
  assert.equal(s.key, 'blocked')
  assert.notEqual(s.label, 'Apto para exibição')
})

test('a live, fully paid campaign with a newer revision in review keeps its live status and surfaces a secondary note', () => {
  const s = deriveAdStatus(
    {
      ...base,
      moderation_state: 'approved',
      state: 'submitted',
      starts_at: '2026-12-01T00:00:00Z',
      expires_at: '2026-12-20T00:00:00Z',
      delivery_state: 'active',
      placement_delivery_active: true,
    },
    { now: NOW }
  )
  assert.equal(s.key, 'live')
  assert.equal(s.pendingRevision, true)
  assert.match(s.label, /Apto para exibição — atualização em análise/)
  assert.equal(s.primaryAction.type, 'track_review')
})

test('a live campaign whose latest revision was rejected still keeps serving the approved one', () => {
  const s = deriveAdStatus(
    {
      ...base,
      moderation_state: 'approved',
      state: 'rejected',
      review_reason: 'Destino divergente do material',
      starts_at: '2026-12-01T00:00:00Z',
      expires_at: '2026-12-20T00:00:00Z',
      delivery_state: 'active',
      placement_delivery_active: true,
    },
    { now: NOW }
  )
  assert.equal(s.key, 'live')
  assert.equal(s.pendingRevision, true)
  assert.match(s.pendingRevisionNote, /Destino divergente do material/)
  assert.equal(s.primaryAction.type, 'edit')
})

test('an incomplete legacy card (no tariff, no placement signal) never throws and never claims live', () => {
  const s = deriveAdStatus({ moderation_state: 'approved', state: 'approved' }, { now: NOW })
  assert.equal(s.key, 'approved_unpaid')
})

test('a contradictory-looking row (archived draft state but still formally approved) resolves to a single Arquivado status', () => {
  const s = deriveAdStatus(
    { ...base, moderation_state: 'archived', state: 'archived', delivery_state: 'active' },
    { now: NOW }
  )
  assert.equal(s.key, 'archived')
  assert.equal(s.label, 'Arquivado')
})

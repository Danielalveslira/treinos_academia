import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toDate, toMillis } from './date.js'
import { formatDate, formatDateTime, formatTime } from './format.js'
import { formatPublicationDateTime } from './expiry.js'
import { requiresEmailVerification, EMAIL_VERIFICATION_CUTOFF } from './emailVerification.js'
import { isAccountRestricted } from './legal.js'

const ISO = '2026-10-02T12:41:00.000Z'

test('toDate accepts a Supabase ISO string and returns the same instant', () => {
  assert.equal(toDate(ISO).toISOString(), ISO)
  assert.equal(toDate('2026-10-02').getUTCFullYear(), 2026)
})

test('toDate returns a Date as-is (same instant) and null for an Invalid Date instance', () => {
  const date = new Date(ISO)
  assert.equal(toDate(date).getTime(), date.getTime())
  assert.equal(toDate(new Date('lixo')), null)
})

test('toDate accepts a legacy Timestamp object (toDate/toMillis), only for compatibility', () => {
  assert.equal(toDate({ toDate: () => new Date(ISO) }).toISOString(), ISO)
  assert.equal(toDate({ toMillis: () => Date.parse(ISO) }).toISOString(), ISO)
})

test('toDate never throws and never invents 1970: null, undefined, empty, invalid and odd values become null', () => {
  for (const value of [
    null,
    undefined,
    '',
    'não é data',
    '2026-13-45',
    {},
    [],
    { toDate: () => 'x' },
    {
      toDate: () => {
        throw new Error('boom')
      },
    },
    true,
    () => {},
  ]) {
    assert.equal(toDate(value), null, String(value))
  }
  assert.equal(toDate(0)?.getTime(), 0) // zero numérico é um instante válido explícito, não "ausente"
})

test('toMillis: 0 for absent/invalid, the instant otherwise, legacy Timestamp supported', () => {
  assert.equal(toMillis(null), 0)
  assert.equal(toMillis(undefined), 0)
  assert.equal(toMillis('lixo'), 0)
  assert.equal(toMillis(ISO), Date.parse(ISO))
  assert.equal(toMillis(new Date(ISO)), Date.parse(ISO))
  assert.equal(toMillis({ toMillis: () => 5 }), 5)
})

test('format helpers accept ISO strings and never throw on missing/invalid input (string has no toLocaleDateString)', () => {
  assert.doesNotMatch(formatDate(ISO), /—|Invalid/)
  assert.match(formatDate(ISO), /2026/)
  assert.match(formatDateTime(ISO), /2026|26/)
  assert.match(formatTime(ISO), /\d{2}:\d{2}/)
  for (const value of [null, undefined, '', 'lixo', new Date('x'), {}]) {
    assert.equal(formatDate(value), '—')
    assert.equal(formatDateTime(value), '—')
    assert.equal(formatTime(value), '—')
  }
})

test('expiry helpers keep working with ISO strings (timestamptz from Supabase)', () => {
  assert.match(formatPublicationDateTime(ISO), /2026/)
  assert.equal(formatPublicationDateTime(null), '—')
  assert.equal(formatPublicationDateTime('lixo'), '—')
})

test('requiresEmailVerification reads createdAt as an ISO string, a Date or a legacy Timestamp', () => {
  const after = new Date(EMAIL_VERIFICATION_CUTOFF.getTime() + 1000)
  const before = new Date(EMAIL_VERIFICATION_CUTOFF.getTime() - 1000)
  assert.equal(requiresEmailVerification({ createdAt: after.toISOString() }), true)
  assert.equal(requiresEmailVerification({ createdAt: before.toISOString() }), false)
  assert.equal(requiresEmailVerification({ createdAt: after }), true)
  assert.equal(requiresEmailVerification({ createdAt: { toDate: () => after } }), true)
  assert.equal(requiresEmailVerification({ createdAt: null }), false)
  assert.equal(requiresEmailVerification(null), false)
})

test('isAccountRestricted handles ISO "until", missing "until" and system bans', () => {
  const future = new Date(Date.now() + 3600_000).toISOString()
  const past = new Date(Date.now() - 3600_000).toISOString()
  assert.equal(isAccountRestricted({ action: 'temporary_suspension', until: future }), true)
  assert.equal(isAccountRestricted({ action: 'temporary_suspension', until: past }), false)
  assert.equal(isAccountRestricted({ action: 'temporary_suspension', until: null }), false)
  assert.equal(isAccountRestricted({ action: 'system_ban' }), true)
  assert.equal(isAccountRestricted(null), false)
})

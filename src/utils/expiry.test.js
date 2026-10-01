import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatPublicationDateTime, formatRemainingTime, toMillis } from './expiry.js'

test('formatRemainingTime uses total hours, including durations above 24h', () => {
  assert.equal(formatRemainingTime(52 * 3600000), '52h restantes')
  assert.equal(formatRemainingTime(18 * 3600000 + 25 * 60000), '18h25min restantes')
  assert.equal(formatRemainingTime(45 * 60000), '45min restantes')
})

test('formatRemainingTime never advertises remaining time after the exact deadline', () => {
  assert.equal(formatRemainingTime(30000), '1min restantes')
  assert.equal(formatRemainingTime(0), 'Expirado')
  assert.equal(formatRemainingTime(-1000), 'Expirado')
  assert.equal(formatRemainingTime(0, 'Promoção encerrada'), 'Promoção encerrada')
})

test('formatPublicationDateTime formats the exact instant in the local timezone', () => {
  const localDate = new Date(2026, 8, 22, 14, 30)
  assert.equal(formatPublicationDateTime(localDate), '22/09/2026 às 14h30')
})

test('toMillis reads a timestamp-shaped value ({ toDate }), Date and raw values', () => {
  const asDate = new Date('2026-09-09T12:00:00Z')
  assert.equal(toMillis(asDate), asDate.getTime())
  assert.equal(toMillis({ toMillis: () => 123 }), 123)
  assert.equal(toMillis({ toDate: () => asDate }), asDate.getTime())
  assert.equal(toMillis(null), 0)
})

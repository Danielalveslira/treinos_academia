import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIcsEvent } from './icsExport.js'

test('builds an RFC 5545 event with title, UTC dates, location and community description', () => {
  const ics = buildIcsEvent({
    uid: 'status-1@evolutus',
    title: 'Treino de pernas',
    startMs: Date.UTC(2026, 8, 26, 20, 30),
    endMs: Date.UTC(2026, 8, 26, 22, 0),
    location: 'Academia X',
    description: 'Comunidade Evolutus: Força SP',
  })

  assert.match(ics, /UID:status-1@evolutus/)
  assert.match(ics, /DTSTART:20260926T203000Z/)
  assert.match(ics, /DTEND:20260926T220000Z/)
  assert.match(ics, /SUMMARY:Treino de pernas/)
  assert.match(ics, /LOCATION:Academia X/)
  assert.match(ics, /DESCRIPTION:Comunidade Evolutus: Força SP/)
  assert.match(ics, /\r\n/)
})

test('escapes text fields without corrupting the calendar structure', () => {
  const ics = buildIcsEvent({
    uid: 'status-2@evolutus',
    title: 'Peito, costas; core',
    startMs: Date.UTC(2026, 8, 26, 20, 30),
    location: 'Rua A, 10',
    description: 'Linha 1\nLinha 2',
  })
  assert.match(ics, /SUMMARY:Peito\\, costas\\; core/)
  assert.match(ics, /LOCATION:Rua A\\, 10/)
  assert.match(ics, /DESCRIPTION:Linha 1\\nLinha 2/)
})

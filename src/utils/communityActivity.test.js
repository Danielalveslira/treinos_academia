import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeActivityPreview,
  formatMemberCount,
  formatRelativeTime,
} from './communityActivity.js'

const NOW = new Date('2026-10-08T12:00:00Z').getTime()
const ago = (ms) => new Date(NOW - ms).toISOString()

test('formatRelativeTime: escalas curtas', () => {
  assert.equal(formatRelativeTime(ago(10 * 1000), NOW), 'agora')
  assert.equal(formatRelativeTime(ago(5 * 60 * 1000), NOW), 'há 5 min')
  assert.equal(formatRelativeTime(ago(2 * 3600 * 1000 + 5000), NOW), 'há 2h')
  assert.equal(formatRelativeTime(ago(3 * 86400 * 1000), NOW), 'há 3d')
})

test('formatRelativeTime: data futura (relógio fora de hora) vira "agora"; inválida vira null', () => {
  assert.equal(formatRelativeTime(new Date(NOW + 60000).toISOString(), NOW), 'agora')
  assert.equal(formatRelativeTime(null, NOW), null)
  assert.equal(formatRelativeTime('lixo', NOW), null)
})

test('formatRelativeTime: após 30 dias usa a data curta', () => {
  assert.match(formatRelativeTime(ago(45 * 86400 * 1000), NOW), /\d{2}/)
})

test('describeActivityPreview: um trecho por tipo de publicação', () => {
  assert.equal(
    describeActivityPreview({ type: 'text', text: '  Bora   treinar \n hoje ' }),
    'Bora treinar hoje'
  )
  assert.equal(
    describeActivityPreview({ type: 'poll', poll: { question: 'Qual split?' } }),
    'Enquete: Qual split?'
  )
  assert.equal(
    describeActivityPreview({ type: 'workout', workout: { title: 'Pernas' } }),
    'Treino marcado: Pernas'
  )
  assert.equal(
    describeActivityPreview({ type: 'achievement', achievement: { text: '' } }),
    'Compartilhou uma conquista'
  )
  assert.equal(describeActivityPreview({ type: 'photo', caption: '' }), 'Compartilhou uma foto')
  assert.equal(describeActivityPreview({ type: 'photo', caption: 'PR!' }), 'PR!')
  assert.equal(describeActivityPreview(null), '')
  assert.equal(describeActivityPreview({ type: 'desconhecido' }), '')
})

test('describeActivityPreview: limita textos longos', () => {
  const out = describeActivityPreview({ type: 'text', text: 'a'.repeat(500) })
  assert.equal(out.length, 140)
  assert.ok(out.endsWith('…'))
})

test('formatMemberCount: singular, plural e milhares', () => {
  assert.equal(formatMemberCount(1), '1 membro')
  assert.equal(formatMemberCount(0), '0 membros')
  assert.equal(formatMemberCount(undefined), '0 membros')
  assert.equal(formatMemberCount(12), '12 membros')
  assert.equal(formatMemberCount(1300), '1,3 mil membros')
  assert.equal(formatMemberCount(2100), '2,1 mil membros')
})

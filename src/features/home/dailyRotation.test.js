import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dailyRotationIndex, pickDailyItem } from './dailyRotation.js'

test('mesma data => sempre o mesmo índice (determinístico, sem Math.random)', () => {
  const a = dailyRotationIndex('2026-10-25', 3)
  const b = dailyRotationIndex('2026-10-25', 3)
  assert.equal(a, b)
  assert.ok(a >= 0 && a < 3)
})

test('dias consecutivos avançam no round-robin e reiniciam depois da última foto', () => {
  const idx = (day) => dailyRotationIndex(day, 3)
  const d1 = idx('2026-10-25')
  assert.equal(idx('2026-10-26'), (d1 + 1) % 3)
  assert.equal(idx('2026-10-27'), (d1 + 2) % 3)
  assert.equal(idx('2026-10-28'), d1) // volta ao início sozinho, sem config extra
})

test('vira o ano sem quebrar a sequência (aritmética de calendário real, não um contador reiniciado)', () => {
  assert.equal(dailyRotationIndex('2027-01-01', 2), (dailyRotationIndex('2026-12-31', 2) + 1) % 2)
})

test('uma única foto aprovada: índice sempre 0, todo dia', () => {
  assert.equal(dailyRotationIndex('2026-10-25', 1), 0)
  assert.equal(dailyRotationIndex('2026-12-31', 1), 0)
})

test('sem fotos aprovadas: índice 0 (não lança) e pickDailyItem devolve null', () => {
  assert.equal(dailyRotationIndex('2026-10-25', 0), 0)
  assert.equal(pickDailyItem([]), null)
  assert.equal(pickDailyItem(null), null)
})

test('pickDailyItem usa o dia de negócio (America/Sao_Paulo) do instante dado, não o fuso do aparelho', () => {
  const photos = ['a', 'b', 'c']
  // 23:30 em SP de 24/10 e 00:30 em SP de 25/10: o que importa é que o dia de NEGÓCIO muda
  // exatamente na meia-noite de SP, não na do fuso do aparelho.
  const beforeMidnight = pickDailyItem(photos, new Date('2026-10-25T02:30:00Z')) // 23:30 SP (dia 24)
  const afterMidnight = pickDailyItem(photos, new Date('2026-10-25T03:30:00Z')) // 00:30 SP (dia 25)
  assert.notEqual(beforeMidnight, afterMidnight)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clockSignature,
  isReminderDue,
  msUntilNextBusinessDay,
  msUntilNextGreetingChange,
  msUntilNextLocalPeriod,
  msUntilReminder,
} from './clock.js'

const HOUR = 3_600_000
const prefs = (extra = {}) => ({
  plannedTrainingDays: ['monday'],
  reminderEnabled: true,
  reminderTime: '19:00',
  timezone: 'America/Sao_Paulo',
  ...extra,
})

test('virada do dia de negócio: falta o que resta até 00:00 em São Paulo', () => {
  // 23:59:00 em SP (02:59Z do dia seguinte)
  assert.equal(msUntilNextBusinessDay(new Date('2026-10-11T02:59:00Z')), 60_000)
  // exatamente 00:00 em SP: faltam 24h (o dia novo já começou)
  assert.equal(msUntilNextBusinessDay(new Date('2026-10-11T03:00:00Z')), 24 * HOUR)
  assert.equal(msUntilNextBusinessDay(new Date('2026-10-10T15:00:00Z')), 12 * HOUR)
})

test('períodos locais: 05:00, 12:00 e 18:00, com volta para 05:00 do dia seguinte', () => {
  const at = (h, m = 0) => new Date(2026, 9, 10, h, m, 0, 0)
  assert.equal(msUntilNextLocalPeriod(at(4, 30)), 30 * 60_000)
  assert.equal(msUntilNextLocalPeriod(at(5)), 7 * HOUR)
  assert.equal(msUntilNextLocalPeriod(at(11, 59)), 60_000)
  assert.equal(msUntilNextLocalPeriod(at(12)), 6 * HOUR)
  assert.equal(msUntilNextLocalPeriod(at(18)), 11 * HOUR)
  assert.equal(msUntilNextLocalPeriod(at(23, 59)), 5 * HOUR + 60_000)
})

test('lembrete: respeita o fuso configurado, não o de Brasília nem o do aparelho', () => {
  const tokyo = prefs({ reminderTime: '08:00', timezone: 'Asia/Tokyo' })
  // 22:00Z = 07:00 em Tóquio
  assert.equal(isReminderDue(tokyo, new Date('2026-10-10T22:00:00Z')), false)
  assert.equal(isReminderDue(tokyo, new Date('2026-10-10T23:01:00Z')), true)
  assert.equal(msUntilReminder(tokyo, new Date('2026-10-10T22:00:00Z')), HOUR)
})

test('lembrete: sem lembrete, já vencido ou desligado => null', () => {
  const now = new Date('2026-10-10T23:00:00Z') // 20:00 em SP
  assert.equal(msUntilReminder(prefs(), now), null)
  assert.equal(msUntilReminder(prefs({ reminderEnabled: false }), now), null)
  assert.equal(msUntilReminder({}, now), null)
  assert.equal(msUntilReminder(prefs(), new Date('2026-10-10T21:00:00Z')), 60 * 60_000) // 18:00 -> faltam 1h
})

test('fuso inválido não derruba a Home: cai para o do aparelho ou para "não vencido"', () => {
  const broken = prefs({ timezone: 'Mars/Olympus' })
  assert.doesNotThrow(() => isReminderDue(broken, new Date()))
  assert.doesNotThrow(() => msUntilReminder(broken, new Date()))
  assert.doesNotThrow(() => clockSignature(broken, new Date()))
})

test('próxima mudança: a menor das fronteiras, com folga e limites seguros', () => {
  const now = new Date('2026-10-10T20:30:00Z') // 17:30 em SP
  const delay = msUntilNextGreetingChange(prefs({ reminderTime: '17:45' }), now)
  assert.ok(delay >= 1000 && delay <= 24 * HOUR)
  // lembrete às 17:45 é a fronteira mais próxima (15 min + 1 s de folga) se o período local não vier antes
  const expected =
    Math.min(msUntilNextBusinessDay(now), msUntilNextLocalPeriod(now), 15 * 60_000) + 1000
  assert.equal(delay, Math.min(24 * HOUR, Math.max(1000, expected)))
  assert.ok(msUntilNextGreetingChange({}, now) <= 24 * HOUR)
})

test('assinatura do relógio só muda quando a frase pode mudar', () => {
  const p = prefs()
  const a = clockSignature(p, new Date('2026-10-10T15:00:00Z')) // 12:00 SP
  const b = clockSignature(p, new Date('2026-10-10T15:00:30Z'))
  assert.equal(a, b)
  const afterReminder = clockSignature(p, new Date('2026-10-10T22:01:00Z')) // 19:01 SP
  assert.notEqual(a, afterReminder)
  const nextDay = clockSignature(p, new Date('2026-10-11T03:00:00Z'))
  assert.notEqual(afterReminder, nextDay)
})

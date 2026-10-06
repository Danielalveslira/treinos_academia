import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import {
  BUSINESS_TIME_ZONE,
  addDaysToDayKey,
  businessDayKey,
  businessDayKeyDaysAgo,
  entityDayKey,
  isBusinessDayKey,
  isFutureBusinessDay,
} from './businessDate.js'
import { validateWorkout } from './validators.js'
import { saoPauloDayKey } from './qualifiedActivity.js'
import { isRelevantToDate } from '../services/offline/outbox.js'

const TIME_ZONES = [
  'America/Fortaleza',
  'America/Sao_Paulo',
  'America/Manaus',
  'America/New_York',
  'UTC',
  'Asia/Tokyo',
]
// Virada da meia-noite em São Paulo (UTC-3, sem horário de verão desde 2019).
const SP_2359 = Date.UTC(2026, 9, 6, 2, 59, 59) // 05/10 23:59:59 em São Paulo
const SP_0000 = Date.UTC(2026, 9, 6, 3, 0, 0) // 06/10 00:00:00 em São Paulo
const SCRIPT_URL = new URL('./businessDate.js', import.meta.url).href

// Roda um trecho num processo com o FUSO DO APARELHO trocado (TZ), como um celular em outro lugar.
function inTimeZone(tz, body) {
  const code = `import * as b from ${JSON.stringify(SCRIPT_URL)}; ${body}`
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  }).trim()
}

test('o dia de negócio é America/Sao_Paulo e a abstração antiga aponta para a mesma fonte', () => {
  assert.equal(BUSINESS_TIME_ZONE, 'America/Sao_Paulo')
  assert.equal(saoPauloDayKey(new Date(SP_2359)), businessDayKey(SP_2359))
})

test('meia-noite de São Paulo: 23:59:59 ainda é o dia 05; 00:00:00 já é o dia 06', () => {
  assert.equal(businessDayKey(SP_2359), '2026-10-05')
  assert.equal(businessDayKey(SP_0000), '2026-10-06')
  assert.equal(businessDayKey(SP_0000 - 1), '2026-10-05')
})

for (const tz of TIME_ZONES) {
  test(`aparelho em ${tz}: "hoje" do Evolutus continua sendo o de São Paulo, na virada da meia-noite`, () => {
    const out = inTimeZone(
      tz,
      `console.log(JSON.stringify([b.businessDayKey(${SP_2359}), b.businessDayKey(${SP_0000}), new Date(${SP_2359}).getDate()]))`
    )
    const [before, after, deviceDay] = JSON.parse(out)
    assert.equal(before, '2026-10-05')
    assert.equal(after, '2026-10-06')
    assert.ok(Number.isInteger(deviceDay)) // o dia do aparelho existe e PODE divergir; o do negócio não
  })
}

test('o fuso do aparelho muda o "dia local" mas nunca o dia de negócio (contraste que justifica o helper)', () => {
  const deviceDays = new Set(
    TIME_ZONES.map((tz) =>
      JSON.parse(inTimeZone(tz, `console.log(JSON.stringify(new Date(${SP_0000}).getDate()))`))
    )
  )
  const businessDays = new Set(
    TIME_ZONES.map((tz) => inTimeZone(tz, `console.log(b.businessDayKey(${SP_0000}))`))
  )
  assert.ok(deviceDays.size > 1, 'o relógio local diverge entre fusos')
  assert.equal(businessDays.size, 1)
  assert.deepEqual([...businessDays], ['2026-10-06'])
})

test('aritmética de dias no calendário do negócio (virada de mês/ano, sem depender de fuso)', () => {
  assert.equal(addDaysToDayKey('2026-03-01', -1), '2026-02-28')
  assert.equal(addDaysToDayKey('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysToDayKey('2028-03-01', -1), '2028-02-29')
  assert.equal(businessDayKeyDaysAgo(371, new Date(SP_0000)), addDaysToDayKey('2026-10-06', -371))
  assert.equal(businessDayKeyDaysAgo(0, new Date(SP_2359)), '2026-10-05')
  assert.throws(() => addDaysToDayKey('ontem', 1), RangeError)
  assert.throws(() => businessDayKey(NaN), RangeError)
})

test('janela de retenção e do dashboard usam o calendário do negócio (não UTC)', () => {
  // 02:00Z de 06/10 ainda é 05/10 em São Paulo: "faz 1 dia" = 04/10 (em UTC seria 05/10).
  assert.equal(businessDayKeyDaysAgo(1, new Date(Date.UTC(2026, 9, 6, 2, 0, 0))), '2026-10-04')
})

test('futuro é medido no dia de negócio: logo antes da meia-noite de SP, o dia "06" ainda é futuro', () => {
  assert.equal(isFutureBusinessDay('2026-10-06', new Date(SP_2359)), true)
  assert.equal(isFutureBusinessDay('2026-10-06', new Date(SP_0000)), false)
  assert.equal(isFutureBusinessDay('2026-10-05', new Date(SP_2359)), false)
  assert.equal(isFutureBusinessDay('invalido', new Date(SP_2359)), false)
})

test('validateWorkout usa o dia de negócio: antes não aceitava "amanhã de SP" só porque em UTC já era o dia seguinte', () => {
  const workout = (date) => ({
    exerciseId: 'ex',
    type: 'strength',
    setDetails: [{ weight: '50', reps: '10' }],
    date,
    note: '',
  })
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 6, 1, 30, 0) }) // 22:30 de 05/10 em SP, já 06/10 em UTC
  try {
    assert.equal(validateWorkout(workout('2026-10-05')).date, undefined)
    assert.equal(validateWorkout(workout('2026-10-06')).date, 'A data não pode ser no futuro')
    mock.timers.setTime(SP_0000)
    assert.equal(validateWorkout(workout('2026-10-06')).date, undefined)
    assert.equal(validateWorkout(workout('2026-10-07')).date, 'A data não pode ser no futuro')
  } finally {
    mock.timers.reset()
  }
})

test('o treino mantém a PRÓPRIA data: sincronizar no dia seguinte não a muda (entityDayKey não usa relógio nem fuso)', () => {
  assert.equal(entityDayKey('2026-10-05T12:00:00'), '2026-10-05')
  assert.equal(entityDayKey('2026-10-05'), '2026-10-05')
  assert.equal(entityDayKey(null), null)
  assert.equal(entityDayKey('lixo'), null)
  for (const tz of TIME_ZONES) {
    assert.equal(
      inTimeZone(tz, `console.log(b.entityDayKey('2026-10-05T12:00:00'))`),
      '2026-10-05',
      tz
    )
  }
})

test('relevância para finalizar usa a data da entidade: um treino de 05/10 sincronizado em 06/10 continua sendo de 05/10', () => {
  const mutation = { dates: ['2026-10-05'] }
  mock.timers.enable({ apis: ['Date'], now: SP_0000 + 3_600_000 }) // já é dia 06 quando sincroniza
  try {
    assert.equal(isRelevantToDate(mutation, businessDayKey()), false) // "hoje" (06) não inclui o treino de ontem
    assert.equal(isRelevantToDate(mutation, '2026-10-05'), true) // finalizar o dia 05 continua enxergando a mutação
  } finally {
    mock.timers.reset()
  }
})

test('treino que muda do dia A para o dia B: concluir A ou B não ignora a mutação', () => {
  const moved = { dates: ['2026-10-04', '2026-10-05'] }
  assert.equal(isRelevantToDate(moved, '2026-10-04'), true)
  assert.equal(isRelevantToDate(moved, '2026-10-05'), true)
  assert.equal(isRelevantToDate(moved, '2026-10-06'), false)
})

test('isBusinessDayKey valida o formato', () => {
  assert.equal(isBusinessDayKey('2026-10-05'), true)
  assert.equal(isBusinessDayKey('2026-1-5'), false)
  assert.equal(isBusinessDayKey(20261005), false)
})

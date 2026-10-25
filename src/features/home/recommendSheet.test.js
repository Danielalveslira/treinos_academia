import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSheetActivityIndex,
  daysBetweenKeys,
  lastTrainedSheet,
  mostTrainedThisMonth,
  recommendSheet,
  relativeDayLabel,
} from './recommendSheet.js'

// Sábado 2026-10-24: Dom=0 Seg=1 Ter=2 Qua=3 Qui=4 Sex=5 Sáb=6
const TODAY = '2026-10-24'
const sheet = (id, over = {}) => ({
  id,
  name: `Ficha ${id}`,
  weekdays: [],
  sort_order: 0,
  exercise_count: 3,
  archived_at: null,
  ...over,
})

test('prioriza a ficha programada para hoje sobre qualquer outra', () => {
  const sheets = [sheet('A', { weekdays: [3] }), sheet('B', { weekdays: [6] })] // hoje é sábado (6)
  const result = recommendSheet(sheets, new Map(), TODAY)
  assert.equal(result.sheet.id, 'B')
  assert.equal(result.reason, 'today')
})

test('entre fichas de hoje, prioriza a que está há mais tempo sem execução', () => {
  const sheets = [sheet('A', { weekdays: [6] }), sheet('B', { weekdays: [6] })]
  const index = buildSheetActivityIndex(
    [
      { sheetId: 'A', date: '2026-10-22' },
      { sheetId: 'B', date: '2026-10-17' },
    ],
    '2026-10-01'
  )
  const result = recommendSheet(sheets, index, TODAY)
  assert.equal(result.sheet.id, 'B') // B não treina há mais tempo
})

test('nunca treinada vence qualquer ficha já treinada, mesmo que programada para hoje', () => {
  const sheets = [sheet('A', { weekdays: [6] }), sheet('B', { weekdays: [6] })]
  const index = buildSheetActivityIndex([{ sheetId: 'A', date: '2026-10-23' }], '2026-10-01')
  const result = recommendSheet(sheets, index, TODAY)
  assert.equal(result.sheet.id, 'B')
})

test('sem ficha para hoje, escolhe a próxima pelos dias cadastrados (menor distância)', () => {
  const sheets = [sheet('A', { weekdays: [1] }), sheet('B', { weekdays: [2] })] // seg=1 (+2), ter=2 (+3)
  const result = recommendSheet(sheets, new Map(), TODAY)
  assert.equal(result.sheet.id, 'A')
  assert.equal(result.reason, 'scheduled')
  assert.equal(result.nextInDays, 2)
})

test('fichas sem dias definidos: ordem determinística por recência, depois pela ordem do usuário', () => {
  const sheets = [sheet('A', { sort_order: 1 }), sheet('B', { sort_order: 0 })]
  const resultTie = recommendSheet(sheets, new Map(), TODAY)
  assert.equal(resultTie.sheet.id, 'B', 'empate: vence a ordem do usuário')
  assert.equal(resultTie.reason, 'fallback')

  const index = buildSheetActivityIndex([{ sheetId: 'B', date: '2026-10-23' }], '2026-10-01')
  const resultRecency = recommendSheet(sheets, index, TODAY)
  assert.equal(resultRecency.sheet.id, 'A', 'A nunca treinou: vence mesmo com sort_order maior')
})

test('nunca recomenda ficha arquivada nem vazia (sem exercícios)', () => {
  const sheets = [
    sheet('archived', { weekdays: [6], archived_at: '2026-10-01T00:00:00Z' }),
    sheet('empty', { weekdays: [6], exercise_count: 0 }),
    sheet('ok', {}),
  ]
  const result = recommendSheet(sheets, new Map(), TODAY)
  assert.equal(result.sheet.id, 'ok')
})

test('sem nenhuma ficha elegível, não recomenda nada (não inventa)', () => {
  const sheets = [sheet('a', { archived_at: '2026-10-01' }), sheet('b', { exercise_count: 0 })]
  assert.equal(recommendSheet(sheets, new Map(), TODAY), null)
  assert.equal(recommendSheet([], new Map(), TODAY), null)
})

test('última ficha treinada: a execução mais recente entre todas', () => {
  const sheets = [sheet('A'), sheet('B')]
  const index = buildSheetActivityIndex(
    [
      { sheetId: 'A', date: '2026-10-20' },
      { sheetId: 'B', date: '2026-10-23' },
    ],
    '2026-10-01'
  )
  const result = lastTrainedSheet(sheets, index)
  assert.equal(result.sheet.id, 'B')
  assert.equal(result.date, '2026-10-23')
})

test('última ficha treinada: null quando não há nenhuma execução (não inventa um "0")', () => {
  assert.equal(lastTrainedSheet([sheet('A')], new Map()), null)
})

test('mais treinada no mês: conta dias DISTINTOS no mês, não linhas (vários exercícios no mesmo dia contam uma vez)', () => {
  const sheets = [sheet('A'), sheet('B')]
  const index = buildSheetActivityIndex(
    [
      { sheetId: 'A', date: '2026-10-05' },
      { sheetId: 'A', date: '2026-10-05' }, // mesmo dia, segundo exercício -- não duplica a contagem
      { sheetId: 'A', date: '2026-10-12' },
      { sheetId: 'B', date: '2026-10-01' },
      { sheetId: 'B', date: '2026-10-08' },
      { sheetId: 'B', date: '2026-10-15' },
    ],
    '2026-10-01'
  )
  const result = mostTrainedThisMonth(sheets, index)
  assert.equal(result.sheet.id, 'B')
  assert.equal(result.count, 3)
})

test('mais treinada no mês: execuções de meses anteriores não contam', () => {
  const sheets = [sheet('A')]
  const index = buildSheetActivityIndex(
    [
      { sheetId: 'A', date: '2026-09-28' },
      { sheetId: 'A', date: '2026-09-29' },
    ],
    '2026-10-01'
  )
  assert.equal(mostTrainedThisMonth(sheets, index), null)
})

test('daysBetweenKeys/relativeDayLabel: hoje, ontem e "há N dias"', () => {
  assert.equal(daysBetweenKeys('2026-10-24', '2026-10-24'), 0)
  assert.equal(daysBetweenKeys('2026-10-22', '2026-10-24'), 2)
  assert.equal(relativeDayLabel(null, TODAY), null)
  assert.equal(relativeDayLabel('2026-10-24', TODAY), 'hoje')
  assert.equal(relativeDayLabel('2026-10-23', TODAY), 'ontem')
  assert.equal(relativeDayLabel('2026-10-20', TODAY), 'há 4 dias')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateBMI,
  calculateWHR,
  calculateLeanMass,
  calculateFatMass,
  calculateWaistHeightRatio,
  getBodyMetricChange,
  getBodyMetricSeries,
  getLatestBodyComposition,
  getWeightTrend,
} from './bodyComposition.js'

test('calculateBMI/WHR/LeanMass return null instead of NaN when an input is missing', () => {
  assert.equal(calculateBMI(null, 180), null)
  assert.equal(calculateBMI(80, null), null)
  assert.ok(Math.abs(calculateBMI(80, 180) - 24.69) < 0.01)
  assert.equal(calculateWHR(null, 100), null)
  assert.equal(calculateWHR(85, 100), 0.85)
  assert.equal(calculateLeanMass(80, null), null)
  assert.equal(calculateLeanMass(80, 20), 64)
})

test('getLatestBodyComposition picks, per indicator, the most recent check-in that has that field', () => {
  const measurements = [
    { date: new Date(2026, 8, 10), weightKg: 79 }, // mais recente, só peso
    { date: new Date(2026, 8, 5), waistCm: 84, hipCm: 98, bodyFatPercent: 17 },
  ]
  const result = getLatestBodyComposition(measurements, 180)
  assert.equal(result.weightKg, 79)
  assert.ok(Math.abs(result.bmi - 24.38) < 0.01)
  assert.equal(result.bodyFatPercent, 17) // veio do check-in mais antigo, é o único com esse campo
  assert.ok(Math.abs(result.whr - 84 / 98) < 0.0001)
})

test('returns nulls across the board with no measurements or no height', () => {
  const empty = getLatestBodyComposition([], 180)
  assert.equal(empty.weightKg, null)
  assert.equal(empty.bmi, null)
  assert.equal(empty.leanMassKg, null)

  const noHeight = getLatestBodyComposition([{ date: new Date(), weightKg: 80 }], null)
  assert.equal(noHeight.weightKg, 80)
  assert.equal(noHeight.bmi, null)
})

test('lean mass prefers a manual value on the most recent qualifying check-in over calculating it', () => {
  const withManualNewer = getLatestBodyComposition(
    [
      { date: new Date(2026, 8, 10), leanMassKg: 66 },
      { date: new Date(2026, 8, 5), weightKg: 80, bodyFatPercent: 20 },
    ],
    180
  )
  assert.equal(withManualNewer.leanMassKg, 66)
  assert.equal(withManualNewer.leanMassSource, 'manual')

  // Mesmo check-in tem os dois: manual vence o cálculo, nunca mistura os dois.
  const sameEntryBoth = getLatestBodyComposition(
    [{ date: new Date(2026, 8, 10), weightKg: 80, bodyFatPercent: 20, leanMassKg: 70 }],
    180
  )
  assert.equal(sameEntryBoth.leanMassKg, 70)
  assert.equal(sameEntryBoth.leanMassSource, 'manual')

  // Sem manual em nenhum check-in mais recente: calcula do peso+gordura mais recente com os dois.
  const calculatedOnly = getLatestBodyComposition(
    [{ date: new Date(2026, 8, 10), weightKg: 80, bodyFatPercent: 20 }],
    180
  )
  assert.equal(calculatedOnly.leanMassKg, 64)
  assert.equal(calculatedOnly.leanMassSource, 'calculated')
})

test('getWeightTrend averages the recent window and compares it to the window right before it', () => {
  const day = (offset, weightKg) => ({
    date: new Date(Date.now() - offset * 86400000),
    weightKg,
  })
  const result = getWeightTrend([
    day(0, 79),
    day(1, 80),
    day(2, 81), // janela atual (0-7 dias): média 80
    day(8, 83),
    day(9, 85), // janela anterior (7-14 dias): média 84
  ])
  assert.ok(Math.abs(result.average - 80) < 0.01)
  assert.ok(result.percentChange < 0) // perdeu peso na comparação
})

test('getWeightTrend has no previous-window comparison when history is too short', () => {
  const result = getWeightTrend([{ date: new Date(), weightKg: 80 }])
  assert.equal(result.average, 80)
  assert.equal(result.percentChange, null)
  assert.deepEqual(getWeightTrend([]), { average: null, percentChange: null })
})

test('derives fat mass and waist-height ratio only from compatible values', () => {
  assert.equal(calculateFatMass(80, 20), 16)
  assert.equal(calculateFatMass(80, null), null)
  assert.equal(calculateWaistHeightRatio(84, 180), 84 / 180)
})

test('manual fat mass wins over the estimate and reports its origin', () => {
  const manual = getLatestBodyComposition(
    [{ date: new Date(2026, 8, 10), weightKg: 80, bodyFatPercent: 20, fatMassKg: 18 }],
    180
  )
  assert.equal(manual.fatMassKg, 18)
  assert.equal(manual.fatMassSource, 'manual')

  const calculated = getLatestBodyComposition(
    [{ date: new Date(2026, 8, 10), weightKg: 80, bodyFatPercent: 20 }],
    180
  )
  assert.equal(calculated.fatMassKg, 16)
  assert.equal(calculated.fatMassSource, 'calculated')
})

test('new circumference metrics support sparse and legacy measurements', () => {
  const measurements = [
    { date: new Date(2026, 8, 10), armCm: 36, chestCm: 102 },
    { date: new Date(2026, 8, 1), abdomenCm: 88, thighCm: 59, calfCm: 39 },
    { date: new Date(2026, 7, 1), weightKg: 80 },
  ]
  const composition = getLatestBodyComposition(measurements, 180)
  assert.equal(composition.armCm, 36)
  assert.equal(composition.abdomenCm, 88)
  assert.deepEqual(
    getBodyMetricSeries(measurements, 'armCm', 30, new Date(2026, 8, 16, 12)).map(
      (point) => point.value
    ),
    [36]
  )
  assert.deepEqual(getBodyMetricSeries(measurements, 'unknown', 30), [])
})

test('body metric series respects the selected period and calculates change', () => {
  const now = new Date(2026, 8, 16, 12)
  const series = getBodyMetricSeries(
    [
      { date: new Date(2026, 8, 16, 12), weightKg: 79 },
      { date: new Date(2026, 8, 1, 12), weightKg: 80 },
      { date: new Date(2026, 6, 1, 12), weightKg: 82 },
    ],
    'weightKg',
    30,
    now
  )
  assert.deepEqual(
    series.map((point) => point.value),
    [80, 79]
  )
  assert.deepEqual(getBodyMetricChange(series), { current: 79, change: -1, trend: 'Em queda' })
})

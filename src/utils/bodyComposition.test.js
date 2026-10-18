import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateBMI,
  calculateWHR,
  calculateLeanMass,
  calculateFatMass,
  calculateWaistHeightRatio,
  classifyBMI,
  getBmiReferenceRange,
  getBmiReferenceWeightRange,
  getBmiScalePosition,
  getBmiWeightGap,
  getBodyMetricChange,
  getBodyMetricSeries,
  getLatestBodyComposition,
  getWeightTrend,
} from './bodyComposition.js'

test('calculateBMI/WHR/LeanMass return null instead of NaN when an input is missing', () => {
  assert.equal(calculateBMI(null, 180), null)
  assert.equal(calculateBMI(80, null), null)
  assert.equal(calculateBMI(-80, 180), null)
  assert.equal(calculateBMI(80, -180), null)
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

test('getBodyMetricSeries computes bodyFatPercent, leanMassKg and fatMassKg from real check-ins (not just weightKg)', () => {
  const now = new Date(2026, 9, 17, 10)
  // Peso e gordura não vêm sempre do mesmo check-in — leanMass/fatMass só podem usar um
  // ponto quando ambos aparecem NO MESMO registro, nunca misturando datas diferentes.
  const measurements = [
    { date: new Date(2026, 9, 17), weightKg: 79.5, bodyFatPercent: 17 },
    { date: new Date(2026, 9, 10), weightKg: 80 }, // só peso, sem gordura nesse dia
    { date: new Date(2026, 8, 20), weightKg: 81, bodyFatPercent: 18 },
    { date: new Date(2026, 8, 1), bodyFatPercent: 19 }, // só gordura, sem peso nesse dia
  ]

  const fat = getBodyMetricSeries(measurements, 'bodyFatPercent', 30, now)
  assert.deepEqual(fat.map((p) => p.value), [18, 17]) // 01/09 (46 dias) fica fora da janela de 30 dias

  const lean = getBodyMetricSeries(measurements, 'leanMassKg', 90, now)
  assert.deepEqual(
    lean.map((p) => p.value),
    [81 * (1 - 18 / 100), 79.5 * (1 - 17 / 100)]
  ) // 10/10 (só peso) e 01/09 (só gordura) nunca entram: faltaria metade do par

  const fatMass = getBodyMetricSeries(measurements, 'fatMassKg', 90, now)
  assert.deepEqual(
    fatMass.map((p) => p.value),
    [81 * (18 / 100), 79.5 * (17 / 100)]
  )
})

test('each period (month/quarter/year) applies its own distinct window, not a shared one', () => {
  const now = new Date(2026, 9, 17, 10)
  const measurements = [
    { date: new Date(2026, 9, 17), weightKg: 79.5 }, // hoje
    { date: new Date(2026, 9, 10), weightKg: 80 }, // 7 dias atrás
    { date: new Date(2026, 8, 20), weightKg: 81 }, // 27 dias atrás: dentro do mês
    { date: new Date(2026, 6, 1), weightKg: 83 }, // 108 dias atrás: fora do mês/trimestre, dentro do ano
    { date: new Date(2025, 9, 1), weightKg: 85 }, // 381 dias atrás: fora de todos
  ]
  assert.deepEqual(
    getBodyMetricSeries(measurements, 'weightKg', 30, now).map((p) => p.value),
    [81, 80, 79.5]
  )
  assert.deepEqual(
    getBodyMetricSeries(measurements, 'weightKg', 90, now).map((p) => p.value),
    [81, 80, 79.5] // mesmo resultado do mês aqui NÃO significa que o filtro é ignorado: é só
    // que não há registros entre 30 e 90 dias nesse cenário (confirmado pelo teste de 365 abaixo)
  )
  assert.deepEqual(
    getBodyMetricSeries(measurements, 'weightKg', 365, now).map((p) => p.value),
    [83, 81, 80, 79.5] // o ano inclui o registro de 108 dias atrás que mês/trimestre excluem
  )
})

test('getBodyMetricSeries ignores records with missing or invalid dates and re-sorts unordered input', () => {
  const now = new Date(2026, 9, 17, 10)
  // Reflete o formato real de listRecentMeasurements: ordem desc por data, não asc.
  const messy = [
    { date: new Date(2026, 9, 10), weightKg: 80 },
    { date: null, weightKg: 999 },
    { date: 'not-a-date', weightKg: 888 },
    { date: new Date(2026, 9, 17), weightKg: 79.5 },
    { date: new Date(2026, 9, 5), weightKg: 80.5 },
  ]
  const series = getBodyMetricSeries(messy, 'weightKg', 30, now)
  assert.deepEqual(
    series.map((p) => p.value),
    [80.5, 80, 79.5] // cronológico, datas inválidas/ausentes nunca aparecem
  )
})

test('getBodyMetricSeries window boundary is inclusive at local midnight of the first day', () => {
  const now = new Date(2026, 9, 17, 10)
  const boundary = [
    { date: new Date(2026, 8, 18, 0, 0, 0), weightKg: 101 }, // início exato da janela de 30 dias: entra
    { date: new Date(2026, 8, 17, 23, 59), weightKg: 999 }, // 1 minuto antes: fica de fora
  ]
  assert.deepEqual(
    getBodyMetricSeries(boundary, 'weightKg', 30, now).map((p) => p.value),
    [101]
  )
})

test('the summary (current/change) shown above the chart always matches the plotted series, never a stale or unrelated metric', () => {
  const now = new Date(2026, 9, 17, 10)
  const measurements = [
    { date: new Date(2026, 9, 17), weightKg: 79.5, bodyFatPercent: 17 },
    { date: new Date(2026, 8, 20), weightKg: 81, bodyFatPercent: 18 },
  ]
  for (const metric of ['weightKg', 'bodyFatPercent']) {
    const series = getBodyMetricSeries(measurements, metric, 90, now)
    const change = getBodyMetricChange(series)
    assert.equal(change.current, series.at(-1).value)
    assert.equal(change.change, series.at(-1).value - series[0].value)
  }
})

test('classifyBMI follows the Ministério da Saúde adult bands and their boundaries', () => {
  assert.equal(classifyBMI(18.4, 30).key, 'abaixoPeso')
  assert.equal(classifyBMI(18.5, 30).key, 'adequado')
  assert.equal(classifyBMI(24.99, 30).key, 'adequado')
  assert.equal(classifyBMI(25, 30).key, 'sobrepeso')
  assert.equal(classifyBMI(29.99, 30).key, 'sobrepeso')
  assert.equal(classifyBMI(30, 30).key, 'obesidade1')
  assert.equal(classifyBMI(35, 30).key, 'obesidade2')
  assert.equal(classifyBMI(40, 30).key, 'obesidade3')
})

test('classifyBMI uses the 22-27 reference band for 60+ instead of the adult bands', () => {
  assert.equal(classifyBMI(21.9, 60).key, 'abaixoPeso')
  assert.equal(classifyBMI(22, 60).key, 'adequado')
  assert.equal(classifyBMI(27, 60).key, 'adequado')
  assert.equal(classifyBMI(27.1, 60).key, 'excessoPeso')
  // a mesma leitura seria "sobrepeso" pela tabela adulta — confirma que 60+ usa outra faixa
  assert.equal(classifyBMI(27.1, 59).key, 'sobrepeso')
})

test('classifyBMI refuses to classify under-20s and anyone without a known age', () => {
  const underTwenty = classifyBMI(22, 19)
  assert.equal(underTwenty.key, 'naoDisponivel')
  assert.equal(underTwenty.tone, 'neutral')
  assert.ok(underTwenty.message.length > 0)

  assert.equal(classifyBMI(22, null), null)
  assert.equal(classifyBMI(null, 30), null)
  assert.equal(classifyBMI(0, 30), null)
})

test('getBmiReferenceRange/WeightRange are age-aware and null without enough data', () => {
  assert.equal(getBmiReferenceRange(19), null)
  assert.deepEqual(getBmiReferenceRange(30), { min: 18.5, max: 24.99 })
  assert.deepEqual(getBmiReferenceRange(60), { min: 22, max: 27 })

  assert.equal(getBmiReferenceWeightRange(180, 19), null)
  assert.equal(getBmiReferenceWeightRange(null, 30), null)
  const adultRange = getBmiReferenceWeightRange(180, 30)
  assert.ok(Math.abs(adultRange.minKg - 59.94) < 0.01)
  assert.ok(Math.abs(adultRange.maxKg - 80.97) < 0.01)
})

test('getBmiWeightGap never suggests weight loss for someone at or below the reference range', () => {
  assert.deepEqual(getBmiWeightGap(70, 180, 30), { status: 'dentro', diffKg: 0 })

  const above = getBmiWeightGap(90, 180, 30)
  assert.equal(above.status, 'acima')
  assert.ok(above.diffKg > 0)

  const below = getBmiWeightGap(50, 180, 30)
  assert.equal(below.status, 'abaixo')
  assert.ok(below.diffKg > 0)

  // sem idade (sem faixa de referência) ou sem peso: não arrisca um resultado
  assert.equal(getBmiWeightGap(70, 180, null), null)
  assert.equal(getBmiWeightGap(null, 180, 30), null)
})

test('getBmiScalePosition clamps outliers to the visual domain', () => {
  assert.equal(getBmiScalePosition(null), null)
  assert.equal(getBmiScalePosition(5), 0)
  assert.equal(getBmiScalePosition(60), 100)
  assert.ok(getBmiScalePosition(30) > 0 && getBmiScalePosition(30) < 100)
})

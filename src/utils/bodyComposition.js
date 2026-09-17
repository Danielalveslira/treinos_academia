import { toDate } from './date.js'

export function calculateBMI(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null
  const heightM = heightCm / 100
  return weightKg / (heightM * heightM)
}

export function calculateWHR(waistCm, hipCm) {
  if (!waistCm || !hipCm) return null
  return waistCm / hipCm
}

export function calculateLeanMass(weightKg, bodyFatPercent) {
  if (!weightKg || bodyFatPercent == null) return null
  return weightKg * (1 - bodyFatPercent / 100)
}

export function calculateFatMass(weightKg, bodyFatPercent) {
  if (!weightKg || bodyFatPercent == null) return null
  return weightKg * (bodyFatPercent / 100)
}

export function calculateWaistHeightRatio(waistCm, heightCm) {
  if (!waistCm || !heightCm) return null
  return waistCm / heightCm
}

// measurements: mais recente primeiro (ordem de listRecentMeasurements). Cada indicador
// usa o check-in mais recente que TEM esse dado — nunca precisa ser o mesmo documento
// pra todos (o usuário pode ter medido cintura/quadril numa data e peso em outra).
export function getLatestBodyComposition(measurements, heightCm) {
  const withWeight = measurements.find((m) => m.weightKg != null)
  const withBodyFat = measurements.find((m) => m.bodyFatPercent != null)
  const withWaist = measurements.find((m) => m.waistCm != null)
  const withWaistHip = measurements.find((m) => m.waistCm != null && m.hipCm != null)
  // Massa magra: pega o check-in mais recente que tem manual OU peso+gordura juntos;
  // dentro DESSE check-in, o valor manual vence o calculado (nunca mistura datas).
  const leanMassEntry = measurements.find(
    (m) => m.leanMassKg != null || (m.weightKg != null && m.bodyFatPercent != null)
  )
  let leanMassKg = null
  let leanMassSource = null
  if (leanMassEntry) {
    if (leanMassEntry.leanMassKg != null) {
      leanMassKg = leanMassEntry.leanMassKg
      leanMassSource = 'manual'
    } else {
      leanMassKg = calculateLeanMass(leanMassEntry.weightKg, leanMassEntry.bodyFatPercent)
      leanMassSource = 'calculated'
    }
  }

  const fatMassEntry = measurements.find(
    (m) => m.fatMassKg != null || (m.weightKg != null && m.bodyFatPercent != null)
  )
  let fatMassKg = null
  let fatMassSource = null
  if (fatMassEntry) {
    if (fatMassEntry.fatMassKg != null) {
      fatMassKg = fatMassEntry.fatMassKg
      fatMassSource = 'manual'
    } else {
      fatMassKg = calculateFatMass(fatMassEntry.weightKg, fatMassEntry.bodyFatPercent)
      fatMassSource = 'calculated'
    }
  }

  const latest = (field) => measurements.find((measurement) => measurement[field] != null)?.[field] ?? null

  return {
    weightKg: withWeight?.weightKg ?? null,
    bmi: withWeight && heightCm ? calculateBMI(withWeight.weightKg, heightCm) : null,
    bodyFatPercent: withBodyFat?.bodyFatPercent ?? null,
    waistCm: withWaist?.waistCm ?? null,
    waistHeightRatio: withWaist ? calculateWaistHeightRatio(withWaist.waistCm, heightCm) : null,
    whr: withWaistHip ? calculateWHR(withWaistHip.waistCm, withWaistHip.hipCm) : null,
    leanMassKg,
    leanMassSource,
    fatMassKg,
    fatMassSource,
    abdomenCm: latest('abdomenCm'),
    hipCm: latest('hipCm'),
    chestCm: latest('chestCm'),
    armCm: latest('armCm'),
    thighCm: latest('thighCm'),
    calfCm: latest('calfCm'),
  }
}

const BODY_FIELDS = {
  weightKg: (measurement) => measurement.weightKg,
  bodyFatPercent: (measurement) => measurement.bodyFatPercent,
  abdomenCm: (measurement) => measurement.abdomenCm,
  waistCm: (measurement) => measurement.waistCm,
  hipCm: (measurement) => measurement.hipCm,
  chestCm: (measurement) => measurement.chestCm,
  armCm: (measurement) => measurement.armCm,
  thighCm: (measurement) => measurement.thighCm,
  calfCm: (measurement) => measurement.calfCm,
  leanMassKg: (measurement) =>
    measurement.leanMassKg ?? calculateLeanMass(measurement.weightKg, measurement.bodyFatPercent),
  fatMassKg: (measurement) =>
    measurement.fatMassKg ?? calculateFatMass(measurement.weightKg, measurement.bodyFatPercent),
}

export function getBodyMetricSeries(measurements, metric, days, now = new Date()) {
  const read = BODY_FIELDS[metric]
  if (!read) return []
  const start = new Date(now)
  start.setDate(start.getDate() - days + 1)
  start.setHours(0, 0, 0, 0)
  return measurements
    .map((measurement) => ({ date: toDate(measurement.date), value: read(measurement) }))
    .filter((point) => point.value != null && point.date >= start)
    .sort((a, b) => a.date - b.date)
    .map((point) => ({
      ...point,
      label: point.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    }))
}

export function getBodyMetricChange(series) {
  if (!series.length) return { current: null, change: null, trend: 'Sem dados' }
  const current = series.at(-1).value
  if (series.length === 1) return { current, change: null, trend: 'Sem comparação' }
  const change = current - series[0].value
  return { current, change, trend: change > 0 ? 'Em alta' : change < 0 ? 'Em queda' : 'Estável' }
}

// Média móvel do peso (janela de windowDays) e variação percentual contra a janela
// imediatamente anterior — evita mostrar como "evolução" a flutuação normal de
// água/comida de um único dia. Roda sobre o que já veio de listRecentMeasurements
// (janela de ~1 ano, poucas dezenas de documentos no máximo — medida corporal não se
// registra com a frequência de um treino), nunca sobre o histórico inteiro.
export function getWeightTrend(measurements, windowDays = 7) {
  const points = measurements
    .filter((m) => m.weightKg != null)
    .map((m) => ({ date: toDate(m.date), weightKg: m.weightKg }))
    .sort((a, b) => b.date - a.date)

  if (points.length === 0) return { average: null, percentChange: null }

  const windowMs = windowDays * 86400000
  const mostRecent = points[0].date
  const average = (list) => list.reduce((sum, p) => sum + p.weightKg, 0) / list.length

  const currentWindow = points.filter((p) => mostRecent - p.date < windowMs)
  const previousWindow = points.filter(
    (p) => mostRecent - p.date >= windowMs && mostRecent - p.date < windowMs * 2
  )

  const currentAverage = average(currentWindow)
  const percentChange = previousWindow.length
    ? ((currentAverage - average(previousWindow)) / average(previousWindow)) * 100
    : null

  return { average: currentAverage, percentChange }
}

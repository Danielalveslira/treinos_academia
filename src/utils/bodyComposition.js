function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value)
}

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

// measurements: mais recente primeiro (ordem de listRecentMeasurements). Cada indicador
// usa o check-in mais recente que TEM esse dado — nunca precisa ser o mesmo documento
// pra todos (o usuário pode ter medido cintura/quadril numa data e peso em outra).
export function getLatestBodyComposition(measurements, heightCm) {
  const withWeight = measurements.find((m) => m.weightKg != null)
  const withBodyFat = measurements.find((m) => m.bodyFatPercent != null)
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

  return {
    weightKg: withWeight?.weightKg ?? null,
    bmi: withWeight && heightCm ? calculateBMI(withWeight.weightKg, heightCm) : null,
    bodyFatPercent: withBodyFat?.bodyFatPercent ?? null,
    whr: withWaistHip ? calculateWHR(withWaistHip.waistCm, withWaistHip.hipCm) : null,
    leanMassKg,
    leanMassSource,
  }
}

// Média móvel do peso (janela de windowDays) e variação percentual contra a janela
// imediatamente anterior — evita mostrar como "evolução" a flutuação normal de
// água/comida de um único dia. Roda sobre o que já veio de listRecentMeasurements
// (janela de ~90 dias, poucas dezenas de documentos no máximo — medida corporal não se
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

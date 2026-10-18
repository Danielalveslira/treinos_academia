import { toDate } from './date.js'

export function calculateBMI(weightKg, heightCm) {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return null
  const heightM = heightCm / 100
  return weightKg / (heightM * heightM)
}

// Faixas do Ministério da Saúde (linhas de cuidado — obesidade no adulto):
// https://linhasdecuidado.saude.gov.br/portal/obesidade-no-adulto/unidade-de-atencao-primaria/definicao-obesidade-no-adulto/indice-massa-corporal/
export const BMI_ADULT_RANGE = { min: 18.5, max: 24.99 }
// Faixa adequada pra 60+ segundo o MS (caderneta de saúde da pessoa idosa / OPAS). O MS
// não publica graus de obesidade específicos pra essa faixa etária, então acima do limite
// é reportado como "excesso de peso" em vez de inventar um grau que não existe na fonte.
export const BMI_ELDERLY_RANGE = { min: 22, max: 27 }
export const BMI_ELDERLY_AGE = 60
// Abaixo disso a tabela de adultos não vale — IMC-por-idade depende de curvas de
// crescimento (SISVAN/OMS por sexo e idade em meses), fora do escopo deste indicador.
export const BMI_YOUNG_ADULT_AGE = 20

const ADULT_BMI_BANDS = [
  { ceiling: 18.5, key: 'abaixoPeso', label: 'Abaixo do peso', tone: 'attention' },
  { ceiling: 25, key: 'adequado', label: 'Faixa de peso adequada', tone: 'accent' },
  { ceiling: 30, key: 'sobrepeso', label: 'Sobrepeso', tone: 'attention' },
  { ceiling: 35, key: 'obesidade1', label: 'Obesidade grau I', tone: 'danger' },
  { ceiling: 40, key: 'obesidade2', label: 'Obesidade grau II', tone: 'danger' },
  { ceiling: Infinity, key: 'obesidade3', label: 'Obesidade grau III', tone: 'danger' },
]

// Classifica o IMC por faixa etária. Sem idade (perfil sem data de nascimento) não
// classifica — é melhor dizer "sem dado" do que arriscar rótulo errado.
export function classifyBMI(bmi, age) {
  if (bmi == null || !Number.isFinite(bmi) || bmi <= 0) return null
  if (age == null || !Number.isFinite(age) || age < 0) return null

  if (age < BMI_YOUNG_ADULT_AGE) {
    return {
      key: 'naoDisponivel',
      label: 'Classificação não disponível',
      tone: 'neutral',
      message:
        'Para menores de 20 anos, a classificação de IMC segue curvas de crescimento por idade (SISVAN/OMS), diferentes da tabela de adultos usada aqui. Consulte um profissional de saúde para interpretar esse valor.',
    }
  }

  if (age >= BMI_ELDERLY_AGE) {
    if (bmi < BMI_ELDERLY_RANGE.min) return { key: 'abaixoPeso', label: 'Abaixo do peso', tone: 'attention' }
    if (bmi <= BMI_ELDERLY_RANGE.max) return { key: 'adequado', label: 'Faixa de peso adequada', tone: 'accent' }
    return { key: 'excessoPeso', label: 'Excesso de peso', tone: 'attention' }
  }

  const band = ADULT_BMI_BANDS.find((b) => bmi < b.ceiling)
  return { key: band.key, label: band.label, tone: band.tone }
}

export function getBmiReferenceRange(age) {
  if (age == null || !Number.isFinite(age) || age < BMI_YOUNG_ADULT_AGE) return null
  return age >= BMI_ELDERLY_AGE ? { ...BMI_ELDERLY_RANGE } : { ...BMI_ADULT_RANGE }
}

export function getBmiReferenceWeightRange(heightCm, age) {
  const range = getBmiReferenceRange(age)
  if (!range || !heightCm || heightCm <= 0) return null
  const heightM = heightCm / 100
  return {
    minKg: range.min * heightM * heightM,
    maxKg: range.max * heightM * heightM,
  }
}

// Diferença de peso até a faixa de referência adequada pra idade. Nunca sugere perda de
// peso pra quem já está na faixa ou abaixo dela — só informa a distância até o limite.
export function getBmiWeightGap(weightKg, heightCm, age) {
  const weightRange = getBmiReferenceWeightRange(heightCm, age)
  if (!weightRange || !weightKg || weightKg <= 0) return null
  if (weightKg > weightRange.maxKg) return { status: 'acima', diffKg: weightKg - weightRange.maxKg }
  if (weightKg < weightRange.minKg) return { status: 'abaixo', diffKg: weightRange.minKg - weightKg }
  return { status: 'dentro', diffKg: 0 }
}

// Posição (0-100) do IMC numa escala visual fixa, só pro indicador gráfico do card —
// clampa extremos pra não distorcer a barra com outliers.
export function getBmiScalePosition(bmi, domainMin = 15, domainMax = 45) {
  if (bmi == null || !Number.isFinite(bmi)) return null
  const clamped = Math.min(Math.max(bmi, domainMin), domainMax)
  return ((clamped - domainMin) / (domainMax - domainMin)) * 100
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

import {
  ADULT_BMI_BANDS,
  BMI_ELDERLY_AGE,
  BMI_ELDERLY_RANGE,
  BMI_YOUNG_ADULT_AGE,
} from './bodyComposition.js'

const VISUAL_KEYS = {
  abaixoPeso: 'below',
  adequado: 'adequate',
  sobrepeso: 'overweight',
  obesidade1: 'obesity-one',
  obesidade2: 'obesity-two',
  obesidade3: 'obesity-three',
}

const ELDERLY_SEGMENTS = [
  { key: 'below', label: 'Abaixo do peso', end: BMI_ELDERLY_RANGE.min },
  { key: 'adequate', label: 'Faixa adequada', end: BMI_ELDERLY_RANGE.max },
  { key: 'overweight', label: 'Excesso de peso', end: Infinity },
]

// Geometria apenas da escala visual: os limites e a posição usam o mesmo eixo linear.
export function buildBmiScale(bmi, age) {
  if (!Number.isFinite(bmi) || bmi <= 0 || !Number.isFinite(age) || age < BMI_YOUNG_ADULT_AGE)
    return null

  const elderly = age >= BMI_ELDERLY_AGE
  const min = Math.min(elderly ? 17 : 15, Math.floor(bmi) - 2)
  const max = Math.max(elderly ? 32 : 45, Math.ceil(bmi) + 2)
  const position = (value) => ((value - min) / (max - min)) * 100
  let start = min
  const bands = elderly
    ? ELDERLY_SEGMENTS
    : ADULT_BMI_BANDS.map(({ key, label, ceiling }) => ({
        key: VISUAL_KEYS[key],
        label,
        end: ceiling,
      }))
  const segments = bands.map(({ key, label, end }) => {
    const stop = Math.min(end, max)
    const segment = { key, label, left: position(start), width: position(stop) - position(start) }
    start = stop
    return segment
  })

  return { min, max, marker: position(bmi), segments }
}

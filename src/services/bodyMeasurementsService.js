import { supabase } from '../supabase/config'
import { invalidateCache } from '../utils/pageCache'

// Medida corporal é esparsa. A janela anual sustenta os gráficos sem uma coleção
// agregada adicional; o teto mantém o custo previsível mesmo em uso atípico.
const SAFETY_LIMIT = 500
const MEASUREMENT_FIELDS = [
  'weightKg',
  'bodyFatPercent',
  'abdomenCm',
  'waistCm',
  'hipCm',
  'chestCm',
  'armCm',
  'thighCm',
  'calfCm',
  'leanMassKg',
  'fatMassKg',
]
const COLUMN_BY_FIELD = {
  weightKg: 'weight_kg',
  bodyFatPercent: 'body_fat_percent',
  abdomenCm: 'abdomen_cm',
  waistCm: 'waist_cm',
  hipCm: 'hip_cm',
  chestCm: 'chest_cm',
  armCm: 'arm_cm',
  thighCm: 'thigh_cm',
  calfCm: 'calf_cm',
  leanMassKg: 'lean_mass_kg',
  fatMassKg: 'fat_mass_kg',
}

function cleanNumber(value) {
  if (value === '' || value == null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function toDoc(row) {
  const doc = { id: row.id, date: row.date, createdAt: row.created_at }
  for (const [field, column] of Object.entries(COLUMN_BY_FIELD)) {
    if (row[column] != null) doc[field] = Number(row[column])
  }
  if (row.note) doc.note = row.note
  return doc
}

export async function listRecentMeasurements(userId) {
  const { data, error } = await supabase
    .from('body_measurements')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(SAFETY_LIMIT)
  if (error) throw error
  return {
    items: data.map(toDoc),
    // Igual a 500 já é tratado de forma conservadora como possível truncamento.
    // Evita uma leitura 501 apenas para distinguir o caso raro de exatamente 500.
    truncated: data.length === SAFETY_LIMIT,
  }
}

// Salva tudo que veio preenchido numa única chamada (save_body_check_in): altura (se
// informada) vai direto pro perfil (muda raramente, não é série temporal), o resto vira
// um novo check-in em body_measurements (nunca sobrescreve o anterior). Campos vazios
// simplesmente não entram no payload -- "só o que sabe".
export async function saveBodyCheckIn(userId, values = {}) {
  const measurement = {}
  for (const field of MEASUREMENT_FIELDS) {
    const value = cleanNumber(values[field])
    if (value != null) measurement[field] = value
  }
  const hasMeasurement = Object.keys(measurement).length > 0
  if (hasMeasurement && values.note?.trim()) measurement.note = values.note.trim()

  const height = cleanNumber(values.heightCm)
  if (height == null && !hasMeasurement) return false

  const payload = { ...measurement }
  if (height != null) payload.heightCm = height
  if (hasMeasurement) payload.date = values.date

  const { data, error } = await supabase.rpc('save_body_check_in', { payload })
  if (error) throw error
  if (hasMeasurement) invalidateCache(`bodyMeasurements:${userId}`)
  return data
}

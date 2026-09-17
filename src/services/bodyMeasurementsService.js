import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { invalidateCache } from '../utils/pageCache'

// Medida corporal é esparsa. A janela anual sustenta os gráficos sem uma coleção
// agregada adicional; o teto mantém o custo previsível mesmo em uso atípico.
const RECENT_WINDOW_DAYS = 371
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

function measurementsRef(userId) {
  return collection(db, 'users', userId, 'bodyMeasurements')
}

function toDoc(d) {
  return { id: d.id, ...d.data() }
}

function toTimestamp(dateString) {
  return Timestamp.fromDate(new Date(`${dateString}T12:00:00`))
}

function cleanNumber(value) {
  if (value === '' || value == null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export async function listRecentMeasurements(userId) {
  const since = Timestamp.fromDate(new Date(Date.now() - RECENT_WINDOW_DAYS * 86400000))
  const q = query(
    measurementsRef(userId),
    where('date', '>=', since),
    orderBy('date', 'desc'),
    limit(SAFETY_LIMIT)
  )
  const snapshot = await getDocs(q)
  return {
    items: snapshot.docs.map(toDoc),
    // Igual a 500 já é tratado de forma conservadora como possível truncamento.
    // Evita uma leitura 501 apenas para distinguir o caso raro de exatamente 500.
    truncated: snapshot.size === SAFETY_LIMIT,
  }
}

// Salva tudo que veio preenchido num único commit: altura (se informada) vai direto pro
// perfil (muda raramente, não é série temporal — ver isValidHeightField), o resto vira
// um novo check-in em bodyMeasurements (nunca sobrescreve o anterior). Campos vazios
// simplesmente não entram no documento — "só o que sabe".
export async function saveBodyCheckIn(
  userId,
  values = {}
) {
  const measurement = {}
  for (const field of MEASUREMENT_FIELDS) {
    const value = cleanNumber(values[field])
    if (value != null) measurement[field] = value
  }
  if (values.note?.trim()) measurement.note = values.note.trim()

  const height = cleanNumber(values.heightCm)
  const hasMeasurement = Object.keys(measurement).length > 0
  if (height == null && !hasMeasurement) return false

  const batch = writeBatch(db)
  if (height != null) batch.set(doc(db, 'users', userId), { heightCm: height }, { merge: true })
  if (hasMeasurement) {
    batch.set(doc(measurementsRef(userId)), {
      ...measurement,
      date: toTimestamp(values.date),
      createdAt: serverTimestamp(),
    })
  }
  await batch.commit()
  // heightCm em si não precisa disso: users/{uid} é sincronizado por listener (ver
  // AuthContext.jsx), não por este cache. Só a lista de check-ins passa por aqui.
  if (hasMeasurement) invalidateCache(`bodyMeasurements:${userId}`)
  return true
}

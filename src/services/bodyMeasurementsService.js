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

// Medida corporal se registra às vezes, não toda hora como treino — 90 dias cobre bem
// mais do que a janela de tendência (7 dias) precisa, e mesmo assim nunca é uma lista
// grande de verdade (ver getWeightTrend, calculations feitas sobre isto no cliente).
const RECENT_WINDOW_DAYS = 90
const SAFETY_LIMIT = 120

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
  return snapshot.docs.map(toDoc)
}

// Salva tudo que veio preenchido num único commit: altura (se informada) vai direto pro
// perfil (muda raramente, não é série temporal — ver isValidHeightField), o resto vira
// um novo check-in em bodyMeasurements (nunca sobrescreve o anterior). Campos vazios
// simplesmente não entram no documento — "só o que sabe".
export async function saveBodyCheckIn(
  userId,
  { date, heightCm, weightKg, bodyFatPercent, waistCm, hipCm, leanMassKg, note } = {}
) {
  const measurement = {}
  const weight = cleanNumber(weightKg)
  const bodyFat = cleanNumber(bodyFatPercent)
  const waist = cleanNumber(waistCm)
  const hip = cleanNumber(hipCm)
  const leanMass = cleanNumber(leanMassKg)
  if (weight != null) measurement.weightKg = weight
  if (bodyFat != null) measurement.bodyFatPercent = bodyFat
  if (waist != null) measurement.waistCm = waist
  if (hip != null) measurement.hipCm = hip
  if (leanMass != null) measurement.leanMassKg = leanMass
  if (note?.trim()) measurement.note = note.trim()

  const height = cleanNumber(heightCm)
  const hasMeasurement = Object.keys(measurement).length > 0
  if (height == null && !hasMeasurement) return false

  const batch = writeBatch(db)
  if (height != null) batch.set(doc(db, 'users', userId), { heightCm: height }, { merge: true })
  if (hasMeasurement) {
    batch.set(doc(measurementsRef(userId)), {
      ...measurement,
      date: toTimestamp(date),
      createdAt: serverTimestamp(),
    })
  }
  await batch.commit()
  // heightCm em si não precisa disso: users/{uid} é sincronizado por listener (ver
  // AuthContext.jsx), não por este cache. Só a lista de check-ins passa por aqui.
  if (hasMeasurement) invalidateCache(`bodyMeasurements:${userId}`)
  return true
}

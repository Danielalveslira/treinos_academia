import {
  collection,
  getAggregateFromServer,
  count,
  sum,
  addDoc,
  updateDoc,
  deleteField,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
  where,
  limit,
  startAfter,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'

import { normalizeWorkout } from '../utils/workoutSets'
import { validateWorkout, hasErrors } from '../utils/validators'
import { invalidateWorkoutCache } from '../utils/pageCache'

const RECENT_PAGE_SIZE = 20

function workoutsRef(userId) {
  return collection(db, 'users', userId, 'workouts')
}

function toDoc(d) {
  return normalizeWorkout({ id: d.id, ...d.data() })
}

function toTimestamp(dateString) {
  return Timestamp.fromDate(new Date(`${dateString}T12:00:00`))
}

export async function listWorkoutsPage(
  userId,
  { exerciseId, startDate, endDate, cursor, pageSize = RECENT_PAGE_SIZE } = {}
) {
  const constraints = []
  if (exerciseId) constraints.push(where('exerciseId', '==', exerciseId))
  if (startDate) constraints.push(where('date', '>=', toTimestamp(startDate)))
  if (endDate) constraints.push(where('date', '<=', toTimestamp(endDate)))
  constraints.push(orderBy('date', 'desc'))
  if (cursor) constraints.push(startAfter(cursor))
  constraints.push(limit(pageSize))

  const snapshot = await getDocs(query(workoutsRef(userId), ...constraints))
  return {
    items: snapshot.docs.map(toDoc),
    nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null,
  }
}

export async function listWorkoutsForExercise(userId, exerciseId, pageSize = 30) {
  const q = query(
    workoutsRef(userId),
    where('exerciseId', '==', exerciseId),
    orderBy('date', 'desc'),
    limit(pageSize)
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(toDoc)
}

function workoutPayload(workout) {
  if (hasErrors(validateWorkout(workout))) throw new Error('Registro de treino inválido')
  const setDetails = workout.setDetails.map(({ weight, reps }) => ({
    weight: Number(weight),
    reps: Number(reps),
  }))
  return {
    exerciseId: workout.exerciseId,
    setDetails,
    sets: setDetails.length,
    date: toTimestamp(workout.date),
    note: workout.note?.trim() || '',
  }
}

export function createWorkout(userId, workout) {
  return addDoc(workoutsRef(userId), workoutPayload(workout)).then((result) => {
    invalidateWorkoutCache(userId)
    return result
  })
}

export function updateWorkout(userId, workoutId, workout) {
  return updateDoc(doc(db, 'users', userId, 'workouts', workoutId), {
    ...workoutPayload(workout),
    weight: deleteField(),
    reps: deleteField(),
    repetitions: deleteField(),
  }).then((result) => {
    invalidateWorkoutCache(userId)
    return result
  })
}

export function deleteWorkout(userId, workoutId) {
  return deleteDoc(doc(db, 'users', userId, 'workouts', workoutId)).then((result) => {
    invalidateWorkoutCache(userId)
    return result
  })
}

// Janela e teto para as métricas de constância (streak/frequência semanal) sem ler a
// coleção inteira: cobre folgas realistas (~1 ano) e limita o custo mesmo para quem
// registra várias séries por dia. Sequências mais longas que isso aparecem "capadas".
const DASHBOARD_HISTORY_DAYS = 371
const DASHBOARD_SAFETY_LIMIT = 500

export async function listDashboardWorkouts(userId) {
  const since = Timestamp.fromDate(new Date(Date.now() - DASHBOARD_HISTORY_DAYS * 86400000))
  const q = query(
    workoutsRef(userId),
    where('date', '>=', since),
    orderBy('date', 'desc'),
    limit(DASHBOARD_SAFETY_LIMIT)
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(toDoc)
}

// Agrégats no servidor: não transfere o histórico para exibir dois totais.
export async function getWorkoutStatistics(userId, day = null) {
  let source = workoutsRef(userId)
  if (day) {
    const start = new Date(`${day}T00:00:00`)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    source = query(
      source,
      where('date', '>=', Timestamp.fromDate(start)),
      where('date', '<', Timestamp.fromDate(end))
    )
  }
  const result = await getAggregateFromServer(source, { entries: count(), sets: sum('sets') })
  return result.data()
}

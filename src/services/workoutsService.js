import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
  where,
  limit,
  startAfter,
  Timestamp,
  getCountFromServer,
} from 'firebase/firestore'
import { db } from '../firebase/config'

const RECENT_PAGE_SIZE = 20

function workoutsRef(userId) {
  return collection(db, 'users', userId, 'workouts')
}

function toDoc(d) {
  return { id: d.id, ...d.data() }
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

export async function countWorkouts(userId) {
  const snapshot = await getCountFromServer(workoutsRef(userId))
  return snapshot.data().count
}

export function createWorkout(userId, workout) {
  return addDoc(workoutsRef(userId), {
    exerciseId: workout.exerciseId,
    weight: Number(workout.weight),
    sets: Number(workout.sets),
    reps: Number(workout.reps),
    date: toTimestamp(workout.date),
    note: workout.note?.trim() || '',
  })
}

export function updateWorkout(userId, workoutId, workout) {
  return updateDoc(doc(db, 'users', userId, 'workouts', workoutId), {
    exerciseId: workout.exerciseId,
    weight: Number(workout.weight),
    sets: Number(workout.sets),
    reps: Number(workout.reps),
    date: toTimestamp(workout.date),
    note: workout.note?.trim() || '',
  })
}

export function deleteWorkout(userId, workoutId) {
  return deleteDoc(doc(db, 'users', userId, 'workouts', workoutId))
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

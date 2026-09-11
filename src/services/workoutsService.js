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
  serverTimestamp,
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

function millisOf(value) {
  return value?.toMillis ? value.toMillis() : new Date(value).getTime()
}

// date guarda só o dia escolhido pelo usuário (sempre meio-dia, ver toTimestamp) — dois
// treinos no mesmo dia empatam nesse campo, e a query só ordena por "date". Desempatar
// aqui, no cliente, por createdAt (carimbo real do servidor) em vez de orderBy('createdAt')
// na própria query: um orderBy em createdAt excluiria da resposta qualquer treino
// registrado antes desse campo existir (Firestore nunca retorna documento sem o campo
// usado em orderBy). Registros antigos sem createdAt ficam no critério de desempate
// anterior (ordem do Firestore), só os novos ganham a ordem cronológica real.
function sortSameDayByCreation(workouts) {
  return [...workouts].sort((a, b) => {
    const byDate = millisOf(b.date) - millisOf(a.date)
    if (byDate !== 0) return byDate
    if (!a.createdAt || !b.createdAt) return 0
    return millisOf(b.createdAt) - millisOf(a.createdAt)
  })
}

function toTimestamp(dateString) {
  return Timestamp.fromDate(new Date(`${dateString}T12:00:00`))
}

// Teto de segurança para o dia que fica no corte da página (ver abaixo) — nenhum uso
// real registra tantos treinos separados num único dia, então isso nunca é atingido na
// prática; existe só pra nunca deixar essa busca extra crescer sem limite.
const SAME_DAY_OVERFLOW_LIMIT = 50

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
  let docs = snapshot.docs

  // "date" só guarda o dia (sempre meio-dia, ver toTimestamp), então o próprio banco
  // ordena registros do mesmo dia só pelo id do documento — sem relação com a hora real
  // de criação. Se o limite da página cortar bem no meio de um dia, o restante desse
  // dia cai na página seguinte, e reordenar cada página separadamente (sortSameDayByCreation)
  // não resolve: um registro mais novo por createdAt pode ficar "depois" na paginação só
  // por ter ficado do outro lado do corte. Busca o resto desse dia agora — nunca mais
  // que isso — e junta ao grupo antes de reordenar, pra ele nunca ficar dividido entre
  // duas páginas.
  if (docs.length === pageSize) {
    const boundaryDoc = docs[docs.length - 1]
    const boundaryDate = boundaryDoc.data().date
    const overflow = await getDocs(
      query(
        workoutsRef(userId),
        ...(exerciseId ? [where('exerciseId', '==', exerciseId)] : []),
        where('date', '==', boundaryDate),
        orderBy('date', 'desc'),
        startAfter(boundaryDoc),
        limit(SAME_DAY_OVERFLOW_LIMIT)
      )
    )
    docs = docs.concat(overflow.docs)
  }

  return {
    items: sortSameDayByCreation(docs.map(toDoc)),
    nextCursor: snapshot.docs.length === pageSize ? docs[docs.length - 1] : null,
  }
}

// Exportado para a UI poder avisar o recorte real nos indicadores (ver ExerciseDetail.jsx)
// em vez de apresentar "Maior carga"/"Volume acumulado" como se fossem o histórico
// completo — um recorde de carga mais antigo que essa página some da comparação.
export const EXERCISE_HISTORY_PAGE_SIZE = 30

export async function listWorkoutsForExercise(
  userId,
  exerciseId,
  pageSize = EXERCISE_HISTORY_PAGE_SIZE
) {
  const q = query(
    workoutsRef(userId),
    where('exerciseId', '==', exerciseId),
    orderBy('date', 'desc'),
    limit(pageSize)
  )
  const snapshot = await getDocs(q)
  return sortSameDayByCreation(snapshot.docs.map(toDoc))
}

function workoutPayload(workout) {
  if (hasErrors(validateWorkout(workout))) throw new Error('Registro de treino inválido')
  const base = {
    exerciseId: workout.exerciseId,
    date: toTimestamp(workout.date),
    note: workout.note?.trim() || '',
  }
  if (workout.type === 'cardio') {
    return {
      ...base,
      type: 'cardio',
      durationMinutes: Number(workout.durationMinutes),
      ...(workout.distanceKm === '' || workout.distanceKm == null
        ? {}
        : { distanceKm: Number(workout.distanceKm) }),
    }
  }
  const setDetails = workout.setDetails.map(({ weight, reps }) => ({
    weight: Number(weight),
    reps: Number(reps),
  }))
  return { ...base, type: 'strength', setDetails, sets: setDetails.length }
}

export function createWorkout(userId, workout) {
  return addDoc(workoutsRef(userId), {
    ...workoutPayload(workout),
    createdAt: serverTimestamp(),
  }).then((result) => {
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
// Exportados para a UI avisar esse recorte nos indicadores que dependem dele (ver
// Dashboard.jsx) — "Melhor carga"/"dias ativos" não cobrem o histórico completo.
export const DASHBOARD_HISTORY_DAYS = 371
export const DASHBOARD_SAFETY_LIMIT = 500

export async function listDashboardWorkouts(userId) {
  const since = Timestamp.fromDate(new Date(Date.now() - DASHBOARD_HISTORY_DAYS * 86400000))
  const q = query(
    workoutsRef(userId),
    where('date', '>=', since),
    orderBy('date', 'desc'),
    limit(DASHBOARD_SAFETY_LIMIT)
  )
  const snapshot = await getDocs(q)
  return sortSameDayByCreation(snapshot.docs.map(toDoc))
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

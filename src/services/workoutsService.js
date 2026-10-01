import { supabase } from '../supabase/config'
import { normalizeWorkout } from '../utils/workoutSets'
import { validateWorkout, hasErrors } from '../utils/validators'
import { invalidateWorkoutCache } from '../utils/pageCache'

const RECENT_PAGE_SIZE = 20

// O restante do app (toDate/millisOf em calculations.js, greeting.js, expiry.js) lê
// datas via `new Date(value)`, e "meio-dia sem timezone" é o que garante que o dia
// escolhido pelo usuário nunca vire o dia anterior/seguinte perto da virada da meia-noite
// — só que agora a coluna `date` do Postgres já guarda só o dia (sem hora), então a
// conversão acontece aqui, na borda entre o banco e o resto do app.
function toWorkoutDate(pgDate) {
  return `${pgDate}T12:00:00`
}

function toDoc(row) {
  return normalizeWorkout({
    id: row.id,
    exerciseId: row.exercise_id,
    type: row.type,
    setDetails: row.set_details,
    sets: row.sets,
    durationMinutes: row.duration_minutes,
    distanceKm: row.distance_km,
    date: toWorkoutDate(row.date),
    note: row.note,
    createdAt: row.created_at,
  })
}

function workoutPayload(workout) {
  if (hasErrors(validateWorkout(workout))) throw new Error('Registro de treino inválido')
  const base = {
    exercise_id: workout.exerciseId,
    date: workout.date,
    note: workout.note?.trim() || '',
  }
  if (workout.type === 'cardio') {
    return {
      ...base,
      type: 'cardio',
      duration_minutes: Number(workout.durationMinutes),
      distance_km: workout.distanceKm === '' || workout.distanceKm == null ? null : Number(workout.distanceKm),
      set_details: null,
      sets: null,
    }
  }
  const setDetails = workout.setDetails.map(({ weight, reps }) => ({
    weight: Number(weight),
    reps: Number(reps),
  }))
  return {
    ...base,
    type: 'strength',
    set_details: setDetails,
    sets: setDetails.length,
    duration_minutes: null,
    distance_km: null,
  }
}

// cursor é opaco pro resto do app (useWorkouts.js só guarda e devolve) — aqui é um par
// (date, created_at) usado para paginação por keyset. Com `date` como coluna real (não
// mais um timestamp fixado ao meio-dia), o próprio ORDER BY já mantém os registros do
// mesmo dia juntos e na ordem certa, sem precisar de nenhuma lógica extra de "buscar o
// resto do dia".
export async function listWorkoutsPage(
  userId,
  { exerciseId, startDate, endDate, cursor, pageSize = RECENT_PAGE_SIZE } = {}
) {
  let q = supabase
    .from('workouts')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(pageSize)

  if (exerciseId) q = q.eq('exercise_id', exerciseId)
  if (startDate) q = q.gte('date', startDate)
  if (endDate) q = q.lte('date', endDate)
  if (cursor) {
    q = q.or(
      `date.lt.${cursor.date},and(date.eq.${cursor.date},created_at.lt.${cursor.createdAt})`
    )
  }

  const { data, error } = await q
  if (error) throw error

  const last = data[data.length - 1]
  return {
    items: data.map(toDoc),
    nextCursor: data.length === pageSize ? { date: last.date, createdAt: last.created_at } : null,
  }
}

// Exportado para a UI poder avisar o recorte real nos indicadores (ver ExerciseDetail.jsx)
// em vez de apresentar "Maior carga"/"Volume acumulado" como se fossem o histórico
// completo — um recorde de carga mais antigo que essa página some da comparação.
export const EXERCISE_HISTORY_PAGE_SIZE = 30

export async function listWorkoutsForExercise(userId, exerciseId, pageSize = EXERCISE_HISTORY_PAGE_SIZE) {
  const { data, error } = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', userId)
    .eq('exercise_id', exerciseId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(pageSize)
  if (error) throw error
  return data.map(toDoc)
}

export async function createWorkout(userId, workout) {
  const { data, error } = await supabase
    .from('workouts')
    .insert({ user_id: userId, ...workoutPayload(workout) })
    .select()
    .single()
  if (error) throw error
  invalidateWorkoutCache(userId)
  return data
}

export async function updateWorkout(userId, workoutId, workout) {
  const { data, error } = await supabase
    .from('workouts')
    .update(workoutPayload(workout))
    .eq('id', workoutId)
    .eq('user_id', userId)
    .select()
    .single()
  if (error) throw error
  invalidateWorkoutCache(userId)
  return data
}

export async function deleteWorkout(userId, workoutId) {
  const { error } = await supabase.from('workouts').delete().eq('id', workoutId).eq('user_id', userId)
  if (error) throw error
  invalidateWorkoutCache(userId)
}

// Janela e teto para as métricas de constância (streak/frequência semanal) sem ler a
// tabela inteira: cobre folgas realistas (~1 ano) e limita o custo mesmo para quem
// registra várias séries por dia. Sequências mais longas que isso aparecem "capadas".
// Exportados para a UI avisar esse recorte nos indicadores que dependem dele (ver
// Dashboard.jsx) — "Melhor carga"/"dias ativos" não cobrem o histórico completo.
export const DASHBOARD_HISTORY_DAYS = 371
export const DASHBOARD_SAFETY_LIMIT = 500

export async function listDashboardWorkouts(userId) {
  const since = new Date(Date.now() - DASHBOARD_HISTORY_DAYS * 86400000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', userId)
    .gte('date', since)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(DASHBOARD_SAFETY_LIMIT)
  if (error) throw error
  return data.map(toDoc)
}

// Agregado no servidor: não transfere o histórico para exibir dois totais. sum(sets)
// ignora nulls naturalmente (treinos cardio não têm sets) — mesmo comportamento do
// getAggregateFromServer original.
export async function getWorkoutStatistics(userId, day = null) {
  const { data, error } = await supabase
    .rpc('get_workout_statistics', { p_user_id: userId, p_day: day })
    .single()
  if (error) throw error
  return { entries: Number(data.entries), sets: Number(data.sets) }
}

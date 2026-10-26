import { supabase } from '../supabase/config'
import { normalizeWorkout } from '../utils/workoutSets'
import { validateWorkout, hasErrors } from '../utils/validators'
import { invalidateWorkoutCache } from '../utils/pageCache'
import { businessDayKeyDaysAgo } from '../utils/businessDate'
import { readThrough } from './offline/readThrough.js'
import {
  cacheWorkoutRow,
  forgetCachedWorkout,
  overlayPendingWorkouts,
  readCachedWorkoutRow,
  readCachedWorkouts,
  recordWorkoutsPage,
} from './offline/historyCache.js'
import { OPERATIONS, buildLocalRow, hasPendingMutation } from './offline/outbox.js'
import {
  WRITE_TIMEOUT_MS,
  browserSaysOffline,
  canQueueLocally,
  failedByConnectivity,
  queueWorkoutWrite,
  syncedResult,
} from './offline/localWrites.js'

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
    // Ficha em que o registro nasceu (null em treino livre) -- ver sheet_id em
    // supabase/migrations/20261123000001_workout_sheet_attribution.sql. Imutável após a criação.
    sheetId: row.sheet_id ?? null,
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
      distance_km:
        workout.distanceKm === '' || workout.distanceKm == null ? null : Number(workout.distanceKm),
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
export function listWorkoutsPage(
  userId,
  { exerciseId, startDate, endDate, cursor, pageSize = RECENT_PAGE_SIZE, localOnly = false } = {}
) {
  const filters = { exerciseId, startDate, endDate }
  let rows = []
  return readThrough({
    label: 'workouts-page',
    localOnly,
    remote: async () => {
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
      rows = data

      const last = data[data.length - 1]
      // Servidor + o que foi salvo offline e ainda não sincronizou (nunca some da tela).
      const view = await overlayPendingWorkouts(userId, data, { filters, cursor, limit: pageSize })
      return {
        items: view.map(toDoc),
        nextCursor:
          data.length === pageSize ? { date: last.date, createdAt: last.created_at } : null,
      }
    },
    persist: () => recordWorkoutsPage(userId, rows, { filters, cursor, limit: pageSize }),
    local: async () => {
      const page = await readCachedWorkouts(userId, { filters, cursor, limit: pageSize })
      return page && { items: page.rows.map(toDoc), nextCursor: page.nextCursor }
    },
  })
}

// Exportado para a UI poder avisar o recorte real nos indicadores (ver ExerciseDetail.jsx)
// em vez de apresentar "Maior carga"/"Volume acumulado" como se fossem o histórico
// completo — um recorde de carga mais antigo que essa página some da comparação.
export const EXERCISE_HISTORY_PAGE_SIZE = 30

export function listWorkoutsForExercise(
  userId,
  exerciseId,
  pageSize = EXERCISE_HISTORY_PAGE_SIZE,
  { localOnly = false } = {}
) {
  const filters = { exerciseId }
  let rows = []
  return readThrough({
    label: 'workouts-exercise',
    localOnly,
    remote: async () => {
      const { data, error } = await supabase
        .from('workouts')
        .select('*')
        .eq('user_id', userId)
        .eq('exercise_id', exerciseId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(pageSize)
      if (error) throw error
      rows = data
      const view = await overlayPendingWorkouts(userId, data, { filters, limit: pageSize })
      return view.map(toDoc)
    },
    persist: () => recordWorkoutsPage(userId, rows, { filters, limit: pageSize }),
    local: async () => {
      const page = await readCachedWorkouts(userId, { filters, limit: pageSize })
      return page && page.rows.map(toDoc)
    },
  })
}

// Escrita de treino. Resultado: { persisted, synced, pendingSync, workout }.
//  - synced:true  -> o servidor confirmou (fluxo online de sempre; o servidor é a autoridade);
//  - synced:false -> salvo SÓ neste aparelho + outbox (pendingSync:true), enviado quando houver conexão.
// Com VITE_OFFLINE_WRITE_ENABLED desligada (padrão) o caminho é exatamente o de antes da Fase 3.
// "Finalizar treino" (EvoCoins) NÃO passa por aqui e continua exigindo o servidor.

function writeSignal() {
  return AbortSignal.timeout(WRITE_TIMEOUT_MS)
}

// `id` (opcional): id do registro gerado pelo cliente. Permite repetir a criação sem duplicar o registro
// quando a resposta anterior se perdeu (o id já existente vira atualização) — usado pelo registro série a
// série (utils/rowSaver.js). Sem `id`, o comportamento é o de sempre.
const UNIQUE_VIOLATION = '23505'

export async function createWorkout(userId, workout, { id: clientId } = {}) {
  const payload = workoutPayload(workout) // valida; inválido nunca chega nem na fila
  const sheetId = workout.sheetId || null
  if (!(await canQueueLocally())) {
    let { data, error } = await supabase
      .from('workouts')
      .insert({
        ...(clientId ? { id: clientId } : {}),
        user_id: userId,
        ...payload,
        sheet_id: sheetId,
      })
      .select()
      .single()
    if (error?.code === UNIQUE_VIOLATION && clientId) {
      ;({ data, error } = await supabase
        .from('workouts')
        .update(payload)
        .eq('id', clientId)
        .eq('user_id', userId)
        .select()
        .single())
    }
    if (error) throw error
    invalidateWorkoutCache(userId)
    cacheWorkoutRow(userId, data) // cache local em segundo plano; nunca lança
    return syncedResult(data)
  }
  // O id nasce no cliente: o MESMO id vale no servidor (sem mapa id-local -> id-remoto) e torna o
  // reenvio idempotente se a resposta se perder.
  const id = clientId || globalThis.crypto.randomUUID()
  if (!browserSaysOffline()) {
    const signal = writeSignal()
    try {
      let { data, error } = await supabase
        .from('workouts')
        .insert({ id, user_id: userId, ...payload, sheet_id: sheetId })
        .select()
        .single()
        .abortSignal(signal)
      if (error?.code === UNIQUE_VIOLATION && clientId) {
        ;({ data, error } = await supabase
          .from('workouts')
          .update(payload)
          .eq('id', id)
          .eq('user_id', userId)
          .select()
          .single()
          .abortSignal(signal))
      }
      if (error) throw error
      invalidateWorkoutCache(userId)
      cacheWorkoutRow(userId, data)
      return syncedResult(data)
    } catch (error) {
      if (!failedByConnectivity(error, signal)) throw error
    }
  }
  invalidateWorkoutCache(userId)
  return queueWorkoutWrite(userId, {
    operation: OPERATIONS.create,
    entityId: id,
    payload: { ...payload, ...(sheetId ? { sheet_id: sheetId } : {}) },
    workout: buildLocalRow(userId, id, { ...payload, sheet_id: sheetId }, null, Date.now()),
  })
}

export async function updateWorkout(userId, workoutId, workout) {
  const payload = workoutPayload(workout)
  if (!(await canQueueLocally())) {
    const { data, error } = await supabase
      .from('workouts')
      .update(payload)
      .eq('id', workoutId)
      .eq('user_id', userId)
      .select()
      .single()
    if (error) throw error
    invalidateWorkoutCache(userId)
    cacheWorkoutRow(userId, data)
    return syncedResult(data)
  }
  // Com mutação pendente para o mesmo registro o servidor pode nem conhecê-lo ainda: a edição entra
  // na fila (compactada com a pendente), nunca vai direto.
  if (!browserSaysOffline() && !(await hasPendingMutation(userId, workoutId))) {
    const signal = writeSignal()
    try {
      const { data, error } = await supabase
        .from('workouts')
        .update(payload)
        .eq('id', workoutId)
        .eq('user_id', userId)
        .select()
        .single()
        .abortSignal(signal)
      if (error) throw error
      invalidateWorkoutCache(userId)
      cacheWorkoutRow(userId, data)
      return syncedResult(data)
    } catch (error) {
      if (!failedByConnectivity(error, signal)) throw error
    }
  }
  const local = await readCachedWorkoutRow(userId, workoutId)
  invalidateWorkoutCache(userId)
  return queueWorkoutWrite(userId, {
    operation: OPERATIONS.update,
    entityId: workoutId,
    payload,
    // Versão que ESTE aparelho viu: o servidor só aplica se ela ainda for a atual (senão, conflito).
    baseUpdatedAt: local?.updated_at ?? null,
    workout: buildLocalRow(userId, workoutId, payload, local, Date.now()),
  })
}

export async function deleteWorkout(userId, workoutId) {
  if (!(await canQueueLocally())) {
    const { error } = await supabase
      .from('workouts')
      .delete()
      .eq('id', workoutId)
      .eq('user_id', userId)
    if (error) throw error
    invalidateWorkoutCache(userId)
    forgetCachedWorkout(userId, workoutId)
    return syncedResult(null)
  }
  if (!browserSaysOffline() && !(await hasPendingMutation(userId, workoutId))) {
    const signal = writeSignal()
    try {
      const { error } = await supabase
        .from('workouts')
        .delete()
        .eq('id', workoutId)
        .eq('user_id', userId)
        .abortSignal(signal)
      if (error) throw error
      invalidateWorkoutCache(userId)
      forgetCachedWorkout(userId, workoutId)
      return syncedResult(null)
    } catch (error) {
      if (!failedByConnectivity(error, signal)) throw error
    }
  }
  const local = await readCachedWorkoutRow(userId, workoutId)
  invalidateWorkoutCache(userId)
  return queueWorkoutWrite(userId, {
    operation: OPERATIONS.delete,
    entityId: workoutId,
    baseUpdatedAt: local?.updated_at ?? null,
  })
}

// Janela e teto para as métricas de constância (streak/frequência semanal) sem ler a
// tabela inteira: cobre folgas realistas (~1 ano) e limita o custo mesmo para quem
// registra várias séries por dia. Sequências mais longas que isso aparecem "capadas".
// Exportados para a UI avisar esse recorte nos indicadores que dependem dele (ver
// Dashboard.jsx) — "Melhor carga"/"dias ativos" não cobrem o histórico completo.
export const DASHBOARD_HISTORY_DAYS = 371
export const DASHBOARD_SAFETY_LIMIT = 500

export function listDashboardWorkouts(userId) {
  const since = businessDayKeyDaysAgo(DASHBOARD_HISTORY_DAYS) // dias de calendário do negócio, não UTC
  const filters = { startDate: since }
  let rows = []
  return readThrough({
    label: 'workouts-dashboard',
    remote: async () => {
      const { data, error } = await supabase
        .from('workouts')
        .select('*')
        .eq('user_id', userId)
        .gte('date', since)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(DASHBOARD_SAFETY_LIMIT)
      if (error) throw error
      rows = data
      const view = await overlayPendingWorkouts(userId, data, {
        filters,
        limit: DASHBOARD_SAFETY_LIMIT,
      })
      return view.map(toDoc)
    },
    persist: () => recordWorkoutsPage(userId, rows, { filters, limit: DASHBOARD_SAFETY_LIMIT }),
    local: async () => {
      const page = await readCachedWorkouts(userId, { filters, limit: DASHBOARD_SAFETY_LIMIT })
      return page && page.rows.map(toDoc)
    },
  })
}

// Aggregate computed by the server: bounded sheet summaries, never raw workout history.
export async function getSheetInsights() {
  const { data, error } = await supabase.rpc('get_my_sheet_insights')
  if (error) throw error
  return data
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

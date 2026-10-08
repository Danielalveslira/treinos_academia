import { supabase } from '../supabase/config'
import { createBatchLoader } from '../utils/batchLoader'
import { onPageCacheClear } from '../utils/pageCache'
import { getPollResults, countParticipants } from './statusesService'

// Estado de interação dos cards do feed (enquete: totais + meu voto; treino marcado: confirmados +
// minha participação) em LOTE: os cards de uma mesma renderização pedem cada um o seu, e o
// batchLoader junta tudo em 1 chamada de totais (RPC em lote) + 1 de "o que é meu" por tipo,
// em vez de 2 chamadas por card. As leituras do que é MEU funcionam sem nenhuma migration
// (RLS libera só as próprias linhas, então .in() em lote devolve só as minhas).
//
// Os RPCs em lote (migration 20261017000001) chegam ao banco depois do código: enquanto não
// existirem (PGRST202 / 42883), cai nas funções unitárias de antes, sem mudar o resultado, só
// o número de chamadas; a ausência é lembrada na sessão para não repetir a tentativa.
const MAX_BATCH = 50

function isMissingFunction(error) {
  return error?.code === 'PGRST202' || error?.code === '42883'
}

let pollBatchMissing = false
let workoutBatchMissing = false

export async function fetchPollStates(statusIds, userId) {
  const states = new Map(statusIds.map((id) => [id, { counts: {}, myOptionId: null }]))
  const mine = supabase
    .from('status_votes')
    .select('status_id,option_id')
    .eq('user_id', userId)
    .in('status_id', statusIds)

  let countsPromise
  if (pollBatchMissing) countsPromise = legacyPollCounts(statusIds)
  else {
    countsPromise = supabase
      .rpc('get_poll_results_batch', { p_status_ids: statusIds })
      .then(({ data, error }) => {
        if (error && isMissingFunction(error)) {
          pollBatchMissing = true
          return legacyPollCounts(statusIds)
        }
        if (error) throw error
        return data.map((row) => ({
          statusId: row.status_id,
          optionId: row.option_id,
          votes: Number(row.votes),
        }))
      })
  }
  const [counts, mineResult] = await Promise.all([countsPromise, mine])
  if (mineResult.error) throw mineResult.error
  for (const row of counts) states.get(row.statusId).counts[row.optionId] = row.votes
  for (const row of mineResult.data) states.get(row.status_id).myOptionId = row.option_id
  return states
}

async function legacyPollCounts(statusIds) {
  const perStatus = await Promise.all(statusIds.map((id) => getPollResults(id, [])))
  return perStatus.flatMap((counts, index) =>
    Object.entries(counts).map(([optionId, votes]) => ({
      statusId: statusIds[index],
      optionId,
      votes,
    }))
  )
}

export async function fetchWorkoutStates(statusIds, userId) {
  const states = new Map(statusIds.map((id) => [id, { count: 0, amParticipant: false }]))
  const mine = supabase
    .from('status_participants')
    .select('status_id')
    .eq('user_id', userId)
    .in('status_id', statusIds)

  let countsPromise
  if (workoutBatchMissing) countsPromise = legacyWorkoutCounts(statusIds)
  else {
    countsPromise = supabase
      .rpc('count_workout_participants_batch', { p_status_ids: statusIds })
      .then(({ data, error }) => {
        if (error && isMissingFunction(error)) {
          workoutBatchMissing = true
          return legacyWorkoutCounts(statusIds)
        }
        if (error) throw error
        return data.map((row) => ({ statusId: row.status_id, count: Number(row.participants) }))
      })
  }
  const [counts, mineResult] = await Promise.all([countsPromise, mine])
  if (mineResult.error) throw mineResult.error
  for (const row of counts) states.get(row.statusId).count = row.count
  for (const row of mineResult.data) states.get(row.status_id).amParticipant = true
  return states
}

async function legacyWorkoutCounts(statusIds) {
  const counts = await Promise.all(statusIds.map((id) => countParticipants(id)))
  return counts.map((count, index) => ({ statusId: statusIds[index], count }))
}

// Um loader por usuário (o lote consulta "o que é meu"): trocar de conta nunca reaproveita o
// estado de outra.
const pollLoaders = new Map()
const workoutLoaders = new Map()
onPageCacheClear(() => {
  pollLoaders.clear()
  workoutLoaders.clear()
})

function loaderFor(map, userId, fetchStates) {
  let loader = map.get(userId)
  if (!loader) {
    loader = createBatchLoader((ids) => fetchStates(ids, userId), {
      maxBatch: MAX_BATCH,
      delayMs: 8,
    })
    map.set(userId, loader)
  }
  return loader
}

export function loadPollState(statusId, userId) {
  return loaderFor(pollLoaders, userId, fetchPollStates).load(statusId)
}

export function loadWorkoutState(statusId, userId) {
  return loaderFor(workoutLoaders, userId, fetchWorkoutStates).load(statusId)
}

// Só para testes: esquece que a RPC em lote "não existe".
export function resetBatchRpcAvailability() {
  pollBatchMissing = false
  workoutBatchMissing = false
}

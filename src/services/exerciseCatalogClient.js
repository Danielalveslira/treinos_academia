import { supabase } from '../supabase/config'

// Único ponto de contato com a ExerciseAPI -- sempre via a Edge Function
// exercise-catalog-proxy, nunca direto (a chave da ExerciseAPI não existe no
// frontend). Erros preservam o código original (INVALID_API_KEY, RATE_LIMIT_EXCEEDED,
// NOT_FOUND, etc. -- ver a função) pra quem chama decidir como reagir (cache stale,
// mensagem amigável, retry).
export class ExerciseCatalogApiError extends Error {
  constructor(code, status) {
    super(code)
    this.name = 'ExerciseCatalogApiError'
    this.code = code
    this.status = status
  }
}

async function callProxy(action, params, signal) {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr) throw sessionErr
  const token = sessionData.session?.access_token
  if (!token) throw new ExerciseCatalogApiError('NOT_AUTHENTICATED', 401)

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/exercise-catalog-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, params }),
    signal,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ExerciseCatalogApiError(body?.error?.code || 'UNKNOWN_ERROR', response.status)
  }
  return body
}

export function searchExercisesRemote(params, signal) {
  return callProxy('search', params, signal)
}

export function getExerciseDetailRemote(providerExerciseId, signal) {
  return callProxy('detail', { id: providerExerciseId }, signal)
}

export function listMusclesRemote(signal) {
  return callProxy('muscles', {}, signal)
}

export function listEquipmentRemote(signal) {
  return callProxy('equipment', {}, signal)
}

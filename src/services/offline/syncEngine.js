import { isBrowserOffline } from './connectivity.js'
import { classifyReadError } from './readError.js'
import {
  OPERATIONS,
  claimNextBatch,
  completeMutation,
  failMutation,
  getOutboxSummary,
  recoverStaleSyncing,
  releaseMutations,
} from './outbox.js'

// Sync Engine: esvazia a outbox do usuário atual enviando lotes ao servidor (RPC
// sync_workout_mutations). Sem React e sem acoplamento com a UI; tudo que toca o mundo externo vem
// por `deps` (sessão, RPC, sondagem, lock, canal), o que permite testar rede caindo, ACK perdido,
// troca de usuário e várias abas sem nenhum navegador.
//
// Garantias:
//  - só envia mutações do usuário da sessão ATUAL e confere a sessão antes de cada lote; o servidor
//    ainda recebe p_expected_user e recusa o lote se a identidade mudou no meio do caminho;
//  - ACK perdido (servidor aplicou, resposta não chegou): o lote volta à fila e o reenvio é resolvido
//    pelo recibo de mutation_id no servidor (already_applied) -- nunca duplica;
//  - falha transitória (rede, timeout, 5xx, RPC indisponível): fica na fila com backoff; passou de
//    MAX_ATTEMPTS vira `failed`/RETRY_LIMIT (para de tentar sozinha, nunca descarta);
//  - falha permanente/conflito: marca `failed` com o motivo e PRESERVA os dados locais;
//  - auth/expirada e troca de usuário não gastam tentativa (nada foi enviado de fato).

const BATCH_SIZE = 25
const MAX_BATCHES_PER_RUN = 20
const RPC_TIMEOUT_MS = 15_000

// Mensagens que o servidor levanta de propósito (public.sync_workout_mutations).
const BATCH_LEVEL_CODES = new Set(['INVALID_BATCH', 'BATCH_TOO_LARGE'])

export function classifySyncError(error, { aborted = false } = {}) {
  const message = typeof error?.message === 'string' ? error.message : ''
  if (message === 'USER_MISMATCH') return 'user-mismatch'
  if (message === 'APP_ACCESS_DENIED') return 'denied'
  if (BATCH_LEVEL_CODES.has(message)) return 'batch-invalid'
  if (message === 'NOT_AUTHENTICATED') return 'auth'
  if (aborted) return 'transient'
  const kind = classifyReadError(error)
  if (kind === 'auth') return 'auth'
  // Rede, timeout, gateway, RPC ainda não publicada, erro desconhecido: tenta de novo com backoff.
  return 'transient'
}

export function toWire(mutation) {
  const wire = {
    mutation_id: mutation.mutation_id,
    operation: mutation.operation,
    entity_id: mutation.entity_id,
    base_updated_at: mutation.base_updated_at ?? null,
  }
  if (mutation.operation !== OPERATIONS.delete) wire.payload = mutation.payload
  return wire
}

export async function syncOutbox({ force = false, reason = 'manual', deps, filter = null } = {}) {
  const session = await deps.getSession()
  const userId = session?.userId
  if (!userId) return { status: 'no-session', userId: null }

  const before = await getOutboxSummary(userId)
  // `syncing` conta: se a aba morreu no meio de um envio só sobram mutações em andamento, e é o lock
  // (não esta checagem) que decide se alguém realmente as está enviando.
  if (before.pending + before.syncing === 0)
    return { status: 'idle', userId, remaining: before.total }
  if (isBrowserOffline()) return { status: 'offline', userId }

  const lock = await deps.withLock(userId, () => run({ userId, force, reason, deps, filter }))
  if (!lock.acquired) return { status: 'locked', userId }
  return lock.value
}

async function run({ userId, force, deps, filter }) {
  deps.channel?.post('sync-started', userId)
  deps.onRunStart?.(userId)
  let result = { status: 'storage-error', userId }
  try {
    result = await execute({ userId, force, deps, filter })
    return result
  } finally {
    deps.onRunEnd?.(userId, result)
    deps.channel?.post('outbox-changed', userId)
    deps.channel?.post(result.status === 'synced' ? 'sync-completed' : 'sync-failed', userId)
  }
}

async function execute({ userId, force, deps, filter }) {
  const outcome = { status: 'synced', userId, applied: 0, failed: 0, released: 0 }
  try {
    // Com o lock em mãos nenhuma outra aba envia: o que estiver `syncing` é resto de crash.
    await recoverStaleSyncing(userId, deps.now())
  } catch {
    return { ...outcome, status: 'storage-error' }
  }
  if (!(await deps.probe({ force }))) return { ...outcome, status: 'unreachable' }

  for (let round = 0; round < MAX_BATCHES_PER_RUN; round += 1) {
    let batch
    try {
      batch = await claimNextBatch(userId, {
        limit: BATCH_SIZE,
        force,
        now: deps.now(),
        filter,
      })
    } catch {
      return { ...outcome, status: 'storage-error' }
    }
    if (batch.length === 0) break

    const ids = batch.map((mutation) => mutation.mutation_id)
    const current = await deps.getSession()
    if (current?.userId !== userId) {
      await releaseMutations(userId, ids, { countAttempt: false, now: deps.now() })
      return { ...outcome, status: 'user-changed' }
    }

    let response
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), deps.rpcTimeoutMs ?? RPC_TIMEOUT_MS)
    try {
      response = await deps.rpc(batch.map(toWire), userId, controller.signal)
    } catch (error) {
      clearTimeout(timer)
      return await handleTransportError({
        error,
        aborted: controller.signal.aborted,
        userId,
        ids,
        outcome,
        deps,
      })
    }
    clearTimeout(timer)
    deps.markReachable?.()

    const results = new Map(
      (Array.isArray(response?.results) ? response.results : []).map((r) => [r.mutation_id, r])
    )
    for (const mutation of batch) {
      const result = results.get(mutation.mutation_id)
      const done = await settle({ userId, mutation, result, deps })
      outcome[done] += 1
    }
  }
  const after = await getOutboxSummary(userId, deps.now())
  if (outcome.released > 0 || after.pending > 0) {
    return {
      ...outcome,
      status: outcome.released > 0 ? 'retry' : 'partial',
      nextAttemptAt: after.nextAttemptAt,
    }
  }
  return outcome
}

// Devolve 'applied' | 'failed' | 'released' (contadores do resultado).
async function settle({ userId, mutation, result, deps }) {
  const now = deps.now()
  if (!result) {
    // Resposta parcial: o servidor não falou desta mutação. Volta à fila (conta como tentativa).
    await releaseMutations(userId, [mutation.mutation_id], { now, random: deps.random })
    return 'released'
  }
  if (result.status === 'applied' || result.status === 'already_applied') {
    await completeMutation(userId, mutation, result, now)
    return 'applied'
  }
  if (result.status === 'conflict') {
    await failMutation(
      userId,
      mutation.mutation_id,
      { code: 'CONFLICT', serverRow: result.server_row ?? null },
      now
    )
    deps.onConflict?.()
    return 'failed'
  }
  if (result.code === 'DEPENDENCY_FAILED') {
    // Uma mutação anterior do mesmo registro falhou: esta só segue depois que o usuário resolver aquela.
    await releaseMutations(userId, [mutation.mutation_id], { countAttempt: false, now })
    return 'released'
  }
  await failMutation(userId, mutation.mutation_id, { code: result.code || 'REJECTED' }, now)
  return 'failed'
}

async function handleTransportError({ error, aborted, userId, ids, outcome, deps }) {
  const kind = classifySyncError(error, { aborted })
  const now = deps.now()
  if (kind === 'auth' || kind === 'user-mismatch' || kind === 'denied') {
    await releaseMutations(userId, ids, {
      countAttempt: false,
      code: kind === 'auth' ? null : kind.toUpperCase(),
      now,
    })
    return { ...outcome, status: kind === 'user-mismatch' ? 'user-changed' : kind }
  }
  if (kind === 'batch-invalid') {
    for (const id of ids) await failMutation(userId, id, { code: error.message }, now)
    return { ...outcome, status: 'failed', failed: outcome.failed + ids.length }
  }
  deps.markUnreachable?.()
  await releaseMutations(userId, ids, { now, random: deps.random })
  const after = await getOutboxSummary(userId, now)
  return {
    ...outcome,
    status: 'retry',
    released: outcome.released + ids.length,
    nextAttemptAt: after.nextAttemptAt,
  }
}

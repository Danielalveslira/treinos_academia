import { isOfflineWriteEnabled, openDatabase } from './database.js'
import { classifyReadError } from './readError.js'
import { enqueueWorkoutMutation } from './outbox.js'
import { announceOutboxChanged, requestSync } from './syncScheduler.js'
import { refreshSyncStatus, setSaving } from './syncStatusStore.js'
import { recordOfflineDiagnostic } from './diagnostics.js'
import { getOfflineRolloutUser, hydrateOfflineRollout, refreshRemoteRollout } from './rollout.js'

// Gravação LOCAL de treino (offline ou com a rede falhando): grava o registro no IndexedDB + enfileira a
// mutação na mesma transação, e SÓ ENTÃO diz "salvo". Nunca devolve algo que pareça confirmação do
// servidor: o resultado carrega `synced:false` e `pendingSync:true`.
//
// Com VITE_OFFLINE_WRITE_ENABLED desligada (padrão) ou sem IndexedDB, canQueueLocally() é false e os
// serviços seguem o fluxo online de antes, inclusive falhando como antes quando a rede cai.

export const WRITE_TIMEOUT_MS = 8000

export async function canQueueLocally() {
  // Cada nova escrita com rede consulta o kill switch; offline conserva só a última decisão
  // recebida para esta conta. Uma falha/timeout não inventa uma coorte nova.
  const userId = getOfflineRolloutUser()
  if (import.meta.env?.PROD && globalThis.navigator?.onLine === false && userId)
    await hydrateOfflineRollout(userId, { force: true })
  if (import.meta.env?.PROD && globalThis.navigator?.onLine !== false) {
    if (userId) {
      let timeout
      try {
        await Promise.race([
          refreshRemoteRollout(userId),
          new Promise((resolve) => { timeout = setTimeout(resolve, 1500) }),
        ])
      } finally { clearTimeout(timeout) }
    }
  }
  return isOfflineWriteEnabled() && (await openDatabase()) !== null
}

export function browserSaysOffline() {
  return globalThis.navigator?.onLine === false
}

// A gravação online falhou de um jeito que NÃO diz se o servidor aplicou ou não (rede, timeout):
// é seguro (e idempotente, pelo id gerado no cliente) guardar localmente e reenviar depois. Erro de
// validação/permissão/auth NÃO cai aqui: continua sendo erro para o usuário.
export function failedByConnectivity(error, signal) {
  return Boolean(signal?.aborted) || classifyReadError(error) === 'connectivity'
}

export function syncedResult(workout) {
  return { persisted: true, synced: true, pendingSync: false, workout }
}

export async function queueWorkoutWrite(
  userId,
  { operation, entityId, payload, baseUpdatedAt = null, workout = null }
) {
  setSaving(true)
  try {
    const queued = await enqueueWorkoutMutation(userId, {
      operation,
      entityId,
      payload,
      baseUpdatedAt,
    })
    recordOfflineDiagnostic('local_write_saved')
    await refreshSyncStatus(userId)
    announceOutboxChanged(userId)
    requestSync('local-write')
    return {
      persisted: true,
      synced: false,
      pendingSync: true,
      compacted: queued.compacted,
      mutationId: queued.mutation_id,
      workout,
    }
  } finally {
    setSaving(false)
  }
}

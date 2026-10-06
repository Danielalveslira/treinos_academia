import { invalidateWorkoutCache } from '../../utils/pageCache.js'
import {
  discardMutation,
  keepLocalAfterConflict,
  listMutations,
  retryFailed,
  STATUS,
} from './outbox.js'
import { announceOutboxChanged, requestSync } from './syncScheduler.js'
import { refreshSyncStatus } from './syncStatusStore.js'

// Ações do usuário sobre mutações que precisam de atenção (tela "Ver detalhes" do SyncStatus).

export async function listFailedMutations(userId) {
  return (await listMutations(userId)).filter((mutation) => mutation.status === STATUS.failed)
}

const REASONS = {
  CONFLICT: 'Este treino foi alterado em outro aparelho.',
  NOT_FOUND: 'Este treino foi apagado em outro aparelho.',
  INVALID_PAYLOAD: 'Os dados deste registro não foram aceitos.',
  EXERCISE_NOT_FOUND: 'O exercício deste registro não existe mais.',
  TYPE_IMMUTABLE: 'O tipo deste registro não pode mudar.',
  RETRY_LIMIT: 'Não foi possível sincronizar este registro.',
}
export const failureReason = (mutation) =>
  REASONS[mutation.last_error?.code] || 'Não foi possível sincronizar este registro.'

export const isConflict = (mutation) => mutation.last_error?.code === 'CONFLICT'

// 'keep' = manter o meu (só conflito) | 'retry' = tentar de novo | 'discard' = descartar a mudança local
export async function resolveFailedMutation(userId, mutation, action) {
  if (action === 'keep') await keepLocalAfterConflict(userId, mutation.mutation_id)
  else if (action === 'discard') await discardMutation(userId, mutation.mutation_id)
  else if (action === 'retry') await retryFailed(userId)
  invalidateWorkoutCache(userId)
  await refreshSyncStatus(userId)
  announceOutboxChanged(userId)
  if (action !== 'discard') requestSync('resolve', { force: true })
}

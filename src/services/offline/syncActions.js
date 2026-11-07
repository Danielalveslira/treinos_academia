import { invalidateWorkoutCache } from '../../utils/pageCache.js'
import {
  discardMutation,
  keepLocalAfterConflict,
  listMutations,
  recoverMutationWithoutSheet,
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
  CUSTOM_EXERCISES_DISABLED:
    'A criação de exercícios próprios foi encerrada. Os dados continuam neste aparelho; escolha um exercício no Catálogo Evolutus.',
  LEGACY_EXERCISE_READ_ONLY:
    'Exercício antigo: novos treinos exigem um exercício do Catálogo Evolutus. Este registro permanece neste aparelho.',
  CONFLICT: 'Este treino foi alterado em outro aparelho.',
  NOT_FOUND: 'Este treino foi apagado em outro aparelho.',
  INVALID_PAYLOAD: 'Os dados deste registro não foram aceitos.',
  SHEET_NOT_READY:
    'A ficha foi arquivada. Seus registros continuam neste aparelho; revise a ficha e tente novamente.',
  SHEET_NOT_FOUND:
    'A ficha deste treino não existe mais. Seus exercícios registrados foram preservados neste aparelho e podem ser sincronizados sem a ficha.',
  SHEET_EXERCISE_UNAVAILABLE:
    'Um exercício da ficha está indisponível. Revise a ficha antes de sincronizar.',
  SHEET_EXERCISE_MISMATCH:
    'O exercício foi removido da ficha. Revise a ficha antes de sincronizar.',
  SHEET_ID_IMMUTABLE:
    'O vínculo do registro diverge do servidor. Revise os detalhes da sincronização.',
  EXERCISE_NOT_FOUND: 'O exercício deste registro não existe mais.',
  TYPE_IMMUTABLE: 'O tipo deste registro não pode mudar.',
  RETRY_LIMIT: 'Não foi possível sincronizar este registro.',
  catalog_exercise_not_published: 'Este exercício não está mais disponível no catálogo oficial.',
  catalog_exercise_unavailable: 'Este exercício não está mais disponível no catálogo oficial.',
}
export const failureReason = (mutation) =>
  REASONS[mutation.last_error?.code] || 'Não foi possível sincronizar este registro.'

export const isConflict = (mutation) => mutation.last_error?.code === 'CONFLICT'

// Ficha excluída em outro aparelho: "Tentar de novo" só repetiria o mesmo erro; a saída é remover o
// vínculo inválido e reenviar (ver recoverMutationWithoutSheet).
export const isRecoverableSheetGap = (mutation) => mutation.last_error?.code === 'SHEET_NOT_FOUND'

// 'keep' = manter o meu (só conflito) | 'retry' = tentar de novo |
// 'recover-without-sheet' = salvar treino sem ficha (só SHEET_NOT_FOUND) | 'discard' = descartar a mudança local
export async function resolveFailedMutation(userId, mutation, action) {
  if (action === 'keep') await keepLocalAfterConflict(userId, mutation.mutation_id)
  else if (action === 'discard') await discardMutation(userId, mutation.mutation_id)
  else if (action === 'retry') await retryFailed(userId)
  else if (action === 'recover-without-sheet')
    await recoverMutationWithoutSheet(userId, mutation.mutation_id)
  invalidateWorkoutCache(userId)
  await refreshSyncStatus(userId)
  announceOutboxChanged(userId)
  if (action !== 'discard') requestSync('resolve', { force: true })
}

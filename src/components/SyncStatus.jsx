import { isPermanentExerciseFailure } from '../services/offline/outbox.js'
import { useEffect, useState } from 'react'
import { Button } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { useSyncStatus } from '../hooks/useSyncStatus'
import { syncNow } from '../services/offline/syncScheduler'
import { refreshSyncStatus, setSyncUser } from '../services/offline/syncStatusStore'
import {
  failureReason,
  isConflict,
  listFailedMutations,
  resolveFailedMutation,
} from '../services/offline/syncActions'

// Indicador discreto do estado do que foi salvo neste aparelho. Sem modal, sem bloquear o treino,
// sem detalhe técnico: só o texto do estado, a contagem e (se preciso) as ações. Fica oculto quando
// está tudo em dia (e quando a escrita offline está desligada e não há nada pendente).
// criticalOnly: telas que já mostram o estado de gravação no próprio conteúdo (registro de treino) só
// exibem aqui o que exige ação — falha de sincronização —, nunca o aviso rotineiro de offline/pendente.
export function SyncStatus({ criticalOnly = false }) {
  const { user, offlineLocal } = useAuth()
  const { view } = useSyncStatus()
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState([])
  const userId = user?.uid

  useEffect(() => {
    if (!userId) return
    setSyncUser(userId)
    refreshSyncStatus(userId)
  }, [userId])

  useEffect(() => {
    if (!open || view.kind !== 'failed' || !userId) return undefined
    let active = true
    listFailedMutations(userId).then((list) => active && setFailed(list))
    return () => {
      active = false
    }
  }, [open, view.kind, view.failed, userId])

  if (!view.visible || (criticalOnly && view.kind !== 'failed')) return null
  const showSyncButton = view.kind === 'pending' || view.kind === 'failed'

  return (
    <div className={`sync-status sync-status-${view.kind}`} role="status" aria-live="polite">
      <div className="sync-status-line">
        <span className="sync-status-dot" aria-hidden="true" />
        <span className="sync-status-text">{view.text}</span>
        {view.detail && <span className="sync-status-detail">{view.detail}</span>}
        {showSyncButton && view.canSync && !offlineLocal && (
          <Button size="small" variant="invisible" onClick={() => syncNow()}>
            Sincronizar agora
          </Button>
        )}
        {view.kind === 'failed' && (
          <Button
            size="small"
            variant="invisible"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {open ? 'Ocultar' : 'Ver detalhes'}
          </Button>
        )}
      </div>
      {open && view.kind === 'failed' && (
        <ul className="sync-status-list">
          {failed.map((mutation) => (
            <li key={mutation.mutation_id}>
              <span>
                Registro de {mutation.payload?.name || mutation.payload?.date || 'treino'} —{' '}
                {failureReason(mutation)}
              </span>
              <span className="sync-status-actions">
                {mutation.last_error?.code === 'CUSTOM_EXERCISES_DISABLED' &&
                  mutation.payload?.note && <span>{mutation.payload.note}</span>}
                {isConflict(mutation) ? (
                  <>
                    <Button
                      size="small"
                      onClick={() => resolveFailedMutation(userId, mutation, 'keep')}
                    >
                      Manter o meu
                    </Button>
                    <Button
                      size="small"
                      variant="danger"
                      onClick={() => resolveFailedMutation(userId, mutation, 'discard')}
                    >
                      Usar o do servidor
                    </Button>
                  </>
                ) : (
                  <>
                    {!isPermanentExerciseFailure(mutation) && (
                      <Button
                        size="small"
                        onClick={() => resolveFailedMutation(userId, mutation, 'retry')}
                      >
                        Tentar de novo
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="danger"
                      onClick={() => resolveFailedMutation(userId, mutation, 'discard')}
                    >
                      Descartar
                    </Button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

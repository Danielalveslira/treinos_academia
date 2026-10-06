import { useEffect } from 'react'

// Liga o sync enquanto há um usuário logado: tenta ao abrir/autenticar, no evento `online`, ao voltar ao
// primeiro plano e nos retries. Sem usuário não há o que sincronizar (a outbox fica guardada).
//
// A pilha de sync (engine, outbox, scheduler, canal) é carregada SOB DEMANDA, depois do boot: ela só é
// necessária com um usuário logado, e manter fora do bundle de entrada preserva o orçamento de boot do
// PWA (npm run budget). Não é requisito de funcionamento: uma falha ao carregar só adia o sync.
export function useSyncScheduler(userId) {
  useEffect(() => {
    if (!userId) return undefined
    let cancelled = false
    let stop = null
    import('../services/offline/syncScheduler.js')
      .then((module) => {
        if (!cancelled) stop = module.startSyncScheduler(userId)
      })
      .catch((error) => console.warn('[sync] não foi possível iniciar:', error?.name || 'Error'))
    return () => {
      cancelled = true
      stop?.()
    }
  }, [userId])
}

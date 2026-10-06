import { getOutboxSummary } from './outbox.js'
import { publishPendingCount } from './pendingNotice.js'

// Estado de sincronização para a UI (SyncStatus). Store externo mínimo (subscribe/getSnapshot), sem
// React: o Sync Engine e os serviços escrevem aqui; componentes leem via useSyncExternalStore.
// A VERDADE sobre pendências é o IndexedDB (outbox); este estado é só um espelho contado a partir dele.

const SYNCED_FLASH_MS = 4000

function initialState() {
  return {
    userId: null,
    online: globalThis.navigator?.onLine !== false,
    saving: false,
    syncing: false,
    pending: 0, // aguardando envio (inclui o que está sendo enviado)
    failed: 0, // precisam de atenção
    justSynced: false,
    lastSyncedAt: null,
  }
}

let state = initialState()
const listeners = new Set()
let syncedTimer = null

function set(patch) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export const getSyncSnapshot = () => state
export function subscribeSync(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const setSyncUser = (userId) => {
  if (state.userId !== userId) {
    publishPendingCount(0) // a contagem é do usuário atual: nunca mostra a de outra conta
    set({ userId, pending: 0, failed: 0, justSynced: false })
  }
}
export const setOnline = (online) => set({ online })
export const setSaving = (saving) => set({ saving })
export const setSyncing = (syncing) => set({ syncing })

export function markSynced() {
  clearTimeout(syncedTimer)
  set({ justSynced: true, lastSyncedAt: Date.now() })
  syncedTimer = setTimeout(() => set({ justSynced: false }), SYNCED_FLASH_MS)
}

export async function refreshSyncStatus(userId = state.userId) {
  if (!userId) return
  const summary = await getOutboxSummary(userId)
  if (userId !== state.userId) return
  set({ pending: summary.pending + summary.syncing, failed: summary.failed })
  publishPendingCount(summary.total)
}

export function resetSyncStatusForTests() {
  clearTimeout(syncedTimer)
  publishPendingCount(0)
  state = initialState()
  listeners.clear()
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Texto e tipo do indicador. Função PURA (testável): nada de detalhes técnicos para o usuário comum e
// nada de modal. `visible:false` = não mostrar nada (o estado normal, quando está tudo em dia).
export function describeSyncStatus(snapshot, { writeEnabled }) {
  const { saving, syncing, online, pending, failed, justSynced } = snapshot
  if (!writeEnabled && pending === 0 && failed === 0)
    return { visible: false, kind: 'hidden', text: '' }
  if (saving) return { visible: true, kind: 'saving', text: 'Salvando neste aparelho…' }
  if (syncing) return { visible: true, kind: 'syncing', text: 'Sincronizando…', pending }
  if (failed > 0) {
    return {
      visible: true,
      kind: 'failed',
      text: 'Falha ao sincronizar',
      detail: `${plural(failed, 'alteração precisa', 'alterações precisam')} de atenção`,
      failed,
      canSync: online,
    }
  }
  if (!online) {
    return pending > 0
      ? {
          visible: true,
          kind: 'offline-pending',
          text: `Offline • ${plural(pending, 'alteração salva', 'alterações salvas')} neste aparelho`,
          pending,
        }
      : { visible: true, kind: 'offline', text: 'Offline • dados deste aparelho' }
  }
  if (pending > 0) {
    return {
      visible: true,
      kind: 'pending',
      text: `${plural(pending, 'alteração aguardando', 'alterações aguardando')} sincronização`,
      pending,
      canSync: true,
    }
  }
  if (justSynced) return { visible: true, kind: 'synced', text: 'Sincronizado' }
  return { visible: false, kind: 'hidden', text: '' }
}

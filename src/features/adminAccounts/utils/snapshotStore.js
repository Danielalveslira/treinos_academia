// Store do snapshot (sem React, para ser testável com um espião no lugar do Supabase).
//
// Garantias da tela:
//   * nada é lido sozinho: só refresh() chama fetchSnapshot, e no máximo 1 por vez;
//   * erro nunca apaga o snapshot anterior (só registra o erro);
//   * o snapshot novo só substitui o antigo quando a resposta chega completa e válida;
//   * ações administrativas alteram o estado local (applyChanges), sem refetch.

import { applyAccountChanges } from './accounts.js'

export function isValidSnapshot(data) {
  return Boolean(
    data &&
    typeof data === 'object' &&
    Array.isArray(data.accounts) &&
    data.metrics &&
    typeof data.metrics === 'object' &&
    data.meta &&
    data.generated_at
  )
}

export function createSnapshotStore({ fetchSnapshot, onSynced = () => {} }) {
  let state = {
    snapshot: null,
    isRefreshing: false,
    error: null,
    localChangeAt: null, // quando o estado local divergiu do banco por uma ação do admin
    syncedVersion: 0, // incrementa a cada snapshot novo (invalida caches sob demanda)
  }
  const listeners = new Set()
  let inFlight = null

  function set(patch) {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  function refresh() {
    if (inFlight) return inFlight
    set({ isRefreshing: true, error: null })
    inFlight = (async () => {
      try {
        const data = await fetchSnapshot()
        if (!isValidSnapshot(data)) throw new Error('INVALID_SNAPSHOT')
        set({
          snapshot: data,
          isRefreshing: false,
          localChangeAt: null,
          syncedVersion: state.syncedVersion + 1,
        })
        onSynced(data)
        return true
      } catch (error) {
        set({ isRefreshing: false, error })
        return false
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
    applyChanges(changes, at = new Date()) {
      if (!state.snapshot || changes.size === 0) return
      set({ snapshot: applyAccountChanges(state.snapshot, changes), localChangeAt: at })
    },
  }
}

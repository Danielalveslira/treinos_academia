// Store do snapshot (sem React, para ser testável com um espião no lugar do Supabase).
//
// Garantias da tela:
//   * nada é lido sozinho: só refresh() chama fetchSnapshot, e no máximo 1 por vez;
//   * erro nunca apaga o snapshot anterior (só registra o erro);
//   * o snapshot novo só substitui o antigo quando a resposta chega completa e válida;
//   * ações administrativas alteram o estado local (applyChanges), sem refetch.

import { applyAccountChanges } from './accounts.js'

export function isValidSnapshot(data) {
  const count = (value) => Number.isSafeInteger(value) && value >= 0
  return Boolean(
    data &&
    Array.isArray(data.accounts) &&
    data.accounts.length <= 1000 &&
    data.accounts.every(
      (row) =>
        row &&
        typeof row.id === 'string' &&
        (row.email == null || typeof row.email === 'string') &&
        (row.username == null || typeof row.username === 'string') &&
        ['user', 'superadmin'].includes(row.role) &&
        ['active', 'suspended', 'disabled', 'deleting'].includes(row.status)
    ) &&
    new Set(data.accounts.map((row) => row.id)).size === data.accounts.length &&
    data.metrics &&
    [
      'total_accounts',
      'active_accounts',
      'suspended_accounts',
      'new_accounts_7d',
      'pending_deletions',
    ].every((key) => count(data.metrics[key])) &&
    data.meta &&
    count(data.meta.total) &&
    data.meta.returned === data.accounts.length &&
    data.meta.total >= data.meta.returned &&
    typeof data.meta.truncated === 'boolean' &&
    Number.isFinite(Date.parse(data.generated_at))
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
  let epoch = 0

  function set(patch) {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  function refresh() {
    if (inFlight) return inFlight
    set({ isRefreshing: true, error: null })
    const current = epoch
    inFlight = (async () => {
      try {
        const data = await fetchSnapshot()
        if (current !== epoch) return false
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
        if (current !== epoch) return false
        set({ isRefreshing: false, error })
        return false
      } finally {
        if (current === epoch) inFlight = null
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
    clear() {
      epoch += 1
      inFlight = null
      set({
        snapshot: null,
        isRefreshing: false,
        error: null,
        localChangeAt: null,
        syncedVersion: state.syncedVersion + 1,
      })
    },
    applyChanges(changes, at = new Date()) {
      if (!state.snapshot || changes.size === 0) return
      set({ snapshot: applyAccountChanges(state.snapshot, changes), localChangeAt: at })
    },
  }
}

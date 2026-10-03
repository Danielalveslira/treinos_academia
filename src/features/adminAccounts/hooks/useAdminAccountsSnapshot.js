import { useMemo, useRef, useSyncExternalStore } from 'react'
import { fetchAccountsSnapshot } from '../api/adminAccounts.api'
import { createSnapshotStore } from '../utils/snapshotStore'

// Sem React Query: o projeto não usa e esta tela não justifica a dependência. O snapshot vive
// só em memória enquanto a página está montada; não há effect que busque dados -- a primeira
// leitura e todas as seguintes são disparadas exclusivamente pelo botão Atualizar.
export function useAdminAccountsSnapshot() {
  const storeRef = useRef(null)
  if (!storeRef.current) {
    storeRef.current = createSnapshotStore({ fetchSnapshot: fetchAccountsSnapshot })
  }
  const store = storeRef.current
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  return useMemo(
    () => ({ ...state, refresh: store.refresh, applyChanges: store.applyChanges }),
    [state, store]
  )
}

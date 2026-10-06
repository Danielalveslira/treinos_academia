import { useSyncExternalStore } from 'react'
import {
  describeLogoutNotice,
  getPendingCount,
  subscribePendingCount,
} from '../services/offline/pendingNotice.js'

// Texto do aviso de logout (ou null). Só depende do contador mínimo, nunca da pilha de sync.
export function useLogoutNotice() {
  const pending = useSyncExternalStore(subscribePendingCount, getPendingCount, () => 0)
  return describeLogoutNotice(pending)
}

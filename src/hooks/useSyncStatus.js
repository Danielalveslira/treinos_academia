import { useSyncExternalStore } from 'react'
import { isOfflineWriteEnabled } from '../services/offline/database.js'
import {
  describeSyncStatus,
  getSyncSnapshot,
  subscribeSync,
} from '../services/offline/syncStatusStore.js'

export function useSyncStatus() {
  const snapshot = useSyncExternalStore(subscribeSync, getSyncSnapshot, getSyncSnapshot)
  return { snapshot, view: describeSyncStatus(snapshot, { writeEnabled: isOfflineWriteEnabled() }) }
}

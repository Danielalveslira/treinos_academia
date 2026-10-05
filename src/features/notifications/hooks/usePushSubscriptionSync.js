import { useEffect } from 'react'
import { syncPushSubscription } from '../services/pushService'

export function usePushSubscriptionSync(enabled, userId = null) {
  useEffect(() => {
    if (!enabled) return
    let lastSync = 0
    const sync = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastSync < 30 * 60 * 1000) return
      lastSync = Date.now()
      syncPushSubscription({ userId }).catch(() => console.warn('[Push] subscription sync failed'))
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [enabled, userId])
}

import { useEffect } from 'react'
import { invalidatePushOperations, syncPushSubscription } from '../services/pushService'

export function usePushSubscriptionSync(enabled, userId = null) {
  useEffect(() => {
    if (!enabled) return
    let lastSync = 0
    const sync = () => {
      if (
        navigator.onLine === false ||
        document.visibilityState !== 'visible' ||
        Date.now() - lastSync < 30 * 60 * 1000
      )
        return
      lastSync = Date.now()
      syncPushSubscription({ userId }).catch(() => console.warn('[Push] subscription sync failed'))
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('online', sync)
    return () => {
      invalidatePushOperations()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('online', sync)
    }
  }, [enabled, userId])
}

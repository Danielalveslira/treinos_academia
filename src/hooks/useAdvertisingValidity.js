import { useEffect, useState } from 'react'
import {
  createAdvertisingRecovery,
  advertisingOperationalEvent,
  advertisingFailureType,
} from '../utils/advertisingRecovery'
// Paid prominence uses fresh backend decisions and bounded outage recovery.
// Organic community content stays accessible throughout revalidation.
export function useAdvertisingValidity(scope, enabled, revalidate) {
  const [state, setState] = useState({ scope, valid: false })
  useEffect(() => {
    if (!enabled) return undefined
    let live = true,
      generation = 0,
      expiryTimer,
      channel,
      client
    const recovery = createAdvertisingRecovery()
    async function refresh() {
      if (!live) return
      clearTimeout(expiryTimer)
      const current = ++generation
      setState({ scope, valid: false })
      if (document.hidden) return
      const lease = recovery.begin(performance.now())
      if (lease === null) {
        advertisingOperationalEvent(scope, 'recovery_exhausted')
        return
      }
      try {
        const result = await revalidate()
        const deadline = Math.min(result.deadline, lease)
        if (live && current === generation && deadline > performance.now()) {
          result.commit()
          setState({ scope, valid: true })
          advertisingOperationalEvent(scope, 'authorized')
          if (Number.isFinite(deadline))
            expiryTimer = setTimeout(
              refresh,
              Math.min(2 ** 31 - 1, Math.max(1, deadline - performance.now()))
            )
        }
      } catch (error) {
        if (live && current === generation)
          advertisingOperationalEvent(scope, advertisingFailureType(error))
      }
    }
    const foreground = () => refresh()
    import('../supabase/config')
      .then(({ supabase }) => {
        if (!live) return
        client = supabase
        channel = client
          .channel(`advertising-validity:${scope}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'advertising_delivery_epoch' },
            refresh
          )
          .subscribe((status) => {
            if (!live) return
            recovery.status(status)
            advertisingOperationalEvent(
              scope,
              status === 'SUBSCRIBED' ? 'channel_recovered' : 'channel_unavailable'
            )
            refresh()
          })
      })
      .catch(() => {})
    window.addEventListener('focus', foreground)
    document.addEventListener('visibilitychange', foreground)
    return () => {
      live = false
      clearTimeout(expiryTimer)
      generation++
      window.removeEventListener('focus', foreground)
      document.removeEventListener('visibilitychange', foreground)
      if (channel) client.removeChannel(channel)
    }
  }, [scope, enabled, revalidate])
  return enabled && state.scope === scope && state.valid
}

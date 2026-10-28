import { useEffect, useState } from 'react'
import { supabase } from '../supabase/config'
import { authorizedAds, nextAuthorizationDeadline } from '../utils/adAuthorization'
import { useAuth } from './useAuth'
// No cached authorization and no polling. Expiration is enforced separately by
// useAdExpiryTick; foreground navigation always obtains a fresh server decision.
export function useAdvertisingSelection(placementScope, enabled, fetchAds) {
  const { user } = useAuth()
  const scope = `${placementScope}:${user?.uid || 'anonymous'}`
  const [state, setState] = useState({ scope, data: [], loading: enabled, error: null })
  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    let generation = 0
    let disconnected = false
    let expiryTimer
    function publish(data, current) {
      if (!live || current !== generation) return
      const active = authorizedAds(data, performance.now())
      setState({ scope, data: active, loading: false, error: null })
      const deadline = nextAuthorizationDeadline(active)
      if (deadline !== null)
        expiryTimer = setTimeout(
          () => publish(active, current),
          Math.min(2 ** 31 - 1, Math.max(1, deadline - performance.now()))
        )
    }
    async function load() {
      if (disconnected || document.hidden || !live) return
      clearTimeout(expiryTimer)
      const current = ++generation
      setState({ scope, data: [], loading: true, error: null })
      try {
        const data = await fetchAds()
        publish(data, current)
      } catch (error) {
        if (live && generation === current) setState({ scope, data: [], loading: false, error })
      }
    }
    const foreground = () => {
      if (!document.hidden) load()
      else {
        generation++
        setState({ scope, data: [], loading: false, error: null })
      }
    }
    load()
    window.addEventListener('focus', foreground)
    document.addEventListener('visibilitychange', foreground)
    const channel = supabase
      .channel(`advertising:${scope}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'advertising_delivery_epoch' },
        load
      )
      .subscribe((status) => {
        // A disconnected invalidation channel cannot authorize stale campaigns.
        if (status === 'SUBSCRIBED') {
          disconnected = false
          load()
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          disconnected = true
          generation++
          if (live) setState({ scope, data: [], loading: false, error: null })
        }
      })
    return () => {
      clearTimeout(expiryTimer)
      live = false
      generation++
      window.removeEventListener('focus', foreground)
      document.removeEventListener('visibilitychange', foreground)
      supabase.removeChannel(channel)
    }
  }, [scope, enabled, fetchAds])
  return enabled && state.scope === scope ? state : { data: [], loading: enabled, error: null }
}

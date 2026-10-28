import { useEffect, useState } from 'react'
import { supabase } from '../supabase/config'
import { authorizedAds, nextAuthorizationDeadline } from '../utils/adAuthorization'
import {
  createAdvertisingRecovery,
  advertisingOperationalEvent,
  advertisingFailureType,
} from '../utils/advertisingRecovery'
import { useAuth } from './useAuth'
// No cached authorization. A channel outage permits only bounded backend leases.
export function useAdvertisingSelection(placementScope, enabled, fetchAds) {
  const { user } = useAuth()
  const scope = `${placementScope}:${user?.uid || 'anonymous'}`
  const [state, setState] = useState({ scope, data: [], loading: enabled, error: null })
  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    let generation = 0
    const recovery = createAdvertisingRecovery()
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
      return active.length
    }
    async function load() {
      if (document.hidden || !live) return
      clearTimeout(expiryTimer)
      const current = ++generation
      setState({ scope, data: [], loading: true, error: null })
      const lease = recovery.begin(performance.now())
      if (lease === null) {
        setState({ scope, data: [], loading: false, error: null })
        advertisingOperationalEvent(scope, 'recovery_exhausted')
        return
      }
      try {
        const data = await fetchAds()
        if (!live || current !== generation) return
        const activeCount = publish(
          data.map((ad) => ({
            ...ad,
            authorizationUntil: Math.min(ad.authorizationUntil ?? Infinity, lease),
          })),
          current
        )
        advertisingOperationalEvent(
          scope,
          activeCount
            ? 'authorized'
            : data.length
              ? 'authorization_expired'
              : 'no_eligible_campaign'
        )
        if (Number.isFinite(lease)) {
          clearTimeout(expiryTimer)
          const deadline = nextAuthorizationDeadline(data)
          expiryTimer = setTimeout(
            load,
            Math.max(1, Math.min(lease, deadline ?? Infinity) - performance.now())
          )
        }
      } catch (error) {
        if (live && generation === current) {
          setState({ scope, data: [], loading: false, error })
          advertisingOperationalEvent(scope, advertisingFailureType(error))
        }
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
        if (!live) return
        recovery.status(status)
        if (status === 'SUBSCRIBED') {
          advertisingOperationalEvent(scope, 'channel_recovered')
          load()
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          advertisingOperationalEvent(scope, 'channel_unavailable')
          load()
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

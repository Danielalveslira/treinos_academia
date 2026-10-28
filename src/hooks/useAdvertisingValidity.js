import { useEffect, useState } from 'react'
// Paid prominence fails closed when the live invalidation channel is unavailable.
// Organic community content stays accessible throughout revalidation.
export function useAdvertisingValidity(scope, enabled, revalidate) {
  const [state, setState] = useState({ scope, valid: false })
  useEffect(() => {
    if (!enabled) return undefined
    let live = true,
      connected = false,
      generation = 0,
      expiryTimer,
      channel,
      client
    async function refresh() {
      clearTimeout(expiryTimer)
      const current = ++generation
      setState({ scope, valid: false })
      if (!connected || document.hidden) return
      try {
        const deadline = await revalidate()
        if (live && connected && current === generation && deadline > performance.now()) {
          setState({ scope, valid: true })
          if (Number.isFinite(deadline))
            expiryTimer = setTimeout(
              refresh,
              Math.min(2 ** 31 - 1, Math.max(1, deadline - performance.now()))
            )
        }
      } catch {
        /* A failed refresh never reauthorizes cached paid prominence. */
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
            connected = status === 'SUBSCRIBED'
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

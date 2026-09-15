import { useCallback, useEffect, useRef, useState } from 'react'
import { listCommunityFeed, deleteStatus } from '../services/statusesService'
import { describeFirestoreError } from '../utils/firestoreError'
import { toMillis } from '../utils/expiry'
import { fetchCached, getCached, setCached } from '../utils/pageCache'

// Um único relógio compartilhado por feed: os cards leem "now" via prop em vez de cada
// um rodar seu próprio timer, e o mesmo tick também remove localmente quem já expirou —
// sem nenhuma leitura extra ao Firestore, a exclusão física acontece depois, sozinha.
const EXPIRY_TICK_MS = 15000

export function useCommunityFeed(communityId, enabled = true) {
  const cacheKey = `communityFeed:${communityId}`
  const [statuses, setStatuses] = useState(() => (enabled ? getCached(cacheKey) || [] : []))
  const [loading, setLoading] = useState(() => enabled && getCached(cacheKey) === undefined)
  const [ready, setReady] = useState(() => enabled && getCached(cacheKey) !== undefined)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const revision = useRef(0)

  const load = useCallback(
    async (force = false) => {
      if (!enabled || !communityId) return
      const current = ++revision.current
      setLoading(true)
      setError(null)
      try {
        const data = await fetchCached(cacheKey, () => listCommunityFeed(communityId), { force })
        if (current !== revision.current) return
        setNow(Date.now())
        setStatuses(data)
      } catch (err) {
        if (current === revision.current) setError(describeFirestoreError(err, 'useCommunityFeed'))
      } finally {
        if (current === revision.current) {
          setReady(true)
          setLoading(false)
        }
      }
    },
    [enabled, communityId, cacheKey]
  )

  useEffect(() => {
    if (!enabled) {
      revision.current += 1
      setStatuses([])
      setLoading(false)
      setReady(false)
      setError(null)
      return undefined
    }
    const cached = getCached(cacheKey)
    if (cached !== undefined) {
      setStatuses(cached)
      setLoading(false)
      setReady(true)
      setError(null)
    } else {
      load(false)
    }
    return () => {
      revision.current += 1
    }
  }, [enabled, cacheKey, load])

  useEffect(() => {
    if (!enabled) return undefined
    const id = setInterval(() => {
      const current = Date.now()
      setNow(current)
      setStatuses((prev) => {
        const next = prev.filter((s) => toMillis(s.expiresAt) > current)
        if (next.length !== prev.length) setCached(cacheKey, next)
        return next.length === prev.length ? prev : next
      })
    }, EXPIRY_TICK_MS)
    return () => clearInterval(id)
  }, [enabled, cacheKey])

  const refresh = useCallback(() => load(true), [load])

  function addStatusLocally(status) {
    setStatuses((prev) => {
      const next = [status, ...prev]
      setCached(cacheKey, next)
      return next
    })
  }

  async function remove(statusId) {
    await deleteStatus(statusId)
    setStatuses((prev) => {
      const next = prev.filter((s) => s.id !== statusId)
      setCached(cacheKey, next)
      return next
    })
  }

  return {
    statuses: enabled ? statuses : [],
    loading: enabled && (!ready || loading),
    error: enabled ? error : null,
    refresh,
    addStatusLocally,
    remove,
    now,
  }
}

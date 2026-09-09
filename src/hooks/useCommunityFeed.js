import { useCallback, useEffect, useState } from 'react'
import { listCommunityFeed, deleteStatus } from '../services/statusesService'
import { describeFirestoreError } from '../utils/firestoreError'
import { toMillis } from '../utils/expiry'
import { getCached, setCached } from '../utils/pageCache'

// Um único relógio compartilhado por feed: os cards leem "now" via prop em vez de cada
// um rodar seu próprio timer, e o mesmo tick também remove localmente quem já expirou —
// sem nenhuma leitura extra ao Firestore, a exclusão física acontece depois, sozinha.
const EXPIRY_TICK_MS = 15000

export function useCommunityFeed(communityId) {
  const cacheKey = `communityFeed:${communityId}`
  const cached = getCached(cacheKey)
  const [statuses, setStatuses] = useState(cached || [])
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listCommunityFeed(communityId)
      setNow(Date.now())
      setStatuses(data)
      setCached(cacheKey, data)
    } catch (err) {
      setError(describeFirestoreError(err, 'useCommunityFeed'))
    } finally {
      setLoading(false)
    }
     
  }, [communityId, cacheKey])

  useEffect(() => {
    if (!cached) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  useEffect(() => {
    const id = setInterval(() => {
      const current = Date.now()
      setNow(current)
      setStatuses((prev) => {
        const next = prev.filter((s) => toMillis(s.expiresAt) > current)
        if (next.length !== prev.length) setCached(cacheKey, next)
        return next
      })
    }, EXPIRY_TICK_MS)
    return () => clearInterval(id)
     
  }, [cacheKey])

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

  return { statuses, loading, error, refresh, addStatusLocally, remove, now }
}

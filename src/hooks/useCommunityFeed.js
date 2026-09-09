import { useCallback, useEffect, useState } from 'react'
import { listCommunityFeed, deleteStatus } from '../services/statusesService'
import { describeFirestoreError } from '../utils/firestoreError'
import { toMillis } from '../utils/expiry'

// Um único relógio compartilhado por feed: os cards leem "now" via prop em vez de cada
// um rodar seu próprio timer, e o mesmo tick também remove localmente quem já expirou —
// sem nenhuma leitura extra ao Firestore, a exclusão física acontece depois, sozinha.
const EXPIRY_TICK_MS = 15000

export function useCommunityFeed(communityId) {
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listCommunityFeed(communityId)
      setNow(Date.now())
      setStatuses(data)
    } catch (err) {
      setError(describeFirestoreError(err, 'useCommunityFeed'))
    } finally {
      setLoading(false)
    }
  }, [communityId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const id = setInterval(() => {
      const current = Date.now()
      setNow(current)
      setStatuses((prev) => prev.filter((s) => toMillis(s.expiresAt) > current))
    }, EXPIRY_TICK_MS)
    return () => clearInterval(id)
  }, [])

  function addStatusLocally(status) {
    setStatuses((prev) => [status, ...prev])
  }

  async function remove(statusId) {
    await deleteStatus(statusId)
    setStatuses((prev) => prev.filter((s) => s.id !== statusId))
  }

  return { statuses, loading, error, refresh, addStatusLocally, remove, now }
}

import { useCallback, useEffect, useState } from 'react'
import { listCommunityFeed, deleteStatus } from '../services/statusesService'
import { describeFirestoreError } from '../utils/firestoreError'

export function useCommunityFeed(communityId) {
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listCommunityFeed(communityId)
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

  function addStatusLocally(status) {
    setStatuses((prev) => [status, ...prev])
  }

  async function remove(statusId) {
    await deleteStatus(statusId)
    setStatuses((prev) => prev.filter((s) => s.id !== statusId))
  }

  return { statuses, loading, error, refresh, addStatusLocally, remove }
}

import { useCallback } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import { listProgressDays } from '../services/progressService'

const EMPTY = []
export function useProgressDays(currentStart, currentEnd, previousStart, previousEnd) {
  const { user, offlineLocal } = useAuth()
  const fetchValue = useCallback(async () => {
    if (offlineLocal) return []
    const [current, previous] = await Promise.all([
      listProgressDays(user.uid, currentStart, currentEnd),
      listProgressDays(user.uid, previousStart, previousEnd),
    ])
    return [...previous, ...current]
  }, [user.uid, currentStart, currentEnd, previousStart, previousEnd, offlineLocal])
  const { data, loading, error, refresh } = useCachedQuery(
    `progress:${user.uid}:${previousStart}:${previousEnd}:${currentStart}:${currentEnd}:${offlineLocal ? 'local' : 'online'}`,
    fetchValue
  )
  return { days: data || EMPTY, loading, error, refresh }
}

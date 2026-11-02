import { useCallback } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import { listProgressDays } from '../services/progressService'

const EMPTY = []
export function useProgressDays(currentStart, currentEnd, previousStart, previousEnd) {
  const { user, offlineLocal, offlineHome } = useAuth()
  const fetchValue = useCallback(async () => {
    if (offlineLocal) {
      const snapshot = offlineHome?.progress
      if (!snapshot || snapshot.start > previousStart || snapshot.end < currentEnd) return null
      return snapshot.days.filter(
        (day) => day.dateKey >= previousStart && day.dateKey <= currentEnd
      )
    }
    return listProgressDays(user.uid, previousStart, currentEnd)
  }, [user.uid, currentEnd, previousStart, offlineLocal, offlineHome])
  const { data, loading, error, refresh } = useCachedQuery(
    `progress:${user.uid}:${previousStart}:${previousEnd}:${currentStart}:${currentEnd}:${offlineLocal ? 'local' : 'online'}`,
    fetchValue,
    { observeInvalidation: true }
  )
  return {
    days: data || EMPTY,
    available: data !== null,
    offline: offlineLocal,
    loading,
    error,
    refresh,
  }
}

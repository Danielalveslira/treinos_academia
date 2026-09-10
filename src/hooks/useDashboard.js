import { useCallback, useMemo } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import { listDashboardWorkouts } from '../services/workoutsService'

const EMPTY = []
export function useDashboard() {
  const { user } = useAuth()
  const fetchValue = useCallback(async () => {
    const allWorkouts = await listDashboardWorkouts(user.uid)
    return { recentWorkouts: allWorkouts.slice(0, 50), allWorkouts }
  }, [user.uid])
  const { data, loading, error, refresh } = useCachedQuery(`dashboard:${user.uid}`, fetchValue)
  return useMemo(
    () => ({
      recentWorkouts: data?.recentWorkouts || EMPTY,
      allWorkouts: data?.allWorkouts || EMPTY,
      loading,
      error,
      refresh,
    }),
    [data, loading, error, refresh]
  )
}

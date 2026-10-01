import { useCallback, useMemo } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import { listWorkoutsPage } from '../services/workoutsService'
import { listProgressDays } from '../services/progressService'
import { getActivityRange } from '../utils/activityCalendar'

const EMPTY = []

export function useHomeDashboard() {
  const { user } = useAuth()
  const { start, end, year } = getActivityRange()
  const fetchValue = useCallback(async () => {
    const [workoutPage, progressDays] = await Promise.all([
      listWorkoutsPage(user.uid, { pageSize: 50 }),
      listProgressDays(user.uid, start, end),
    ])
    return { recentWorkouts: workoutPage.items, progressDays }
  }, [user.uid, start, end])
  const { data, loading, error, refresh } = useCachedQuery(`home:${user.uid}:${year}`, fetchValue)
  return useMemo(
    () => ({
      recentWorkouts: data?.recentWorkouts || EMPTY,
      progressDays: data?.progressDays || EMPTY,
      loading,
      error,
      refresh,
    }),
    [data, loading, error, refresh]
  )
}

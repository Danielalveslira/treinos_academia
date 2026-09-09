import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { listDashboardWorkouts } from '../services/workoutsService'
import { describeFirestoreError } from '../utils/firestoreError'
import { getCached, setCached } from '../utils/pageCache'

export function useDashboard() {
  const { user } = useAuth()
  const cacheKey = `dashboard:${user.uid}`
  const cached = getCached(cacheKey)
  const [recentWorkouts, setRecentWorkouts] = useState(cached?.recentWorkouts || [])
  const [allWorkouts, setAllWorkouts] = useState(cached?.allWorkouts || [])
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const workouts = await listDashboardWorkouts(user.uid)
      const recent = workouts.slice(0, 50)
      setRecentWorkouts(recent)
      setAllWorkouts(workouts)
      setCached(cacheKey, { recentWorkouts: recent, allWorkouts: workouts })
    } catch (err) {
      setError(describeFirestoreError(err, 'useDashboard'))
    } finally {
      setLoading(false)
    }
     
  }, [user.uid, cacheKey])

  useEffect(() => {
    if (!cached) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  return { recentWorkouts, allWorkouts, loading, error, refresh }
}

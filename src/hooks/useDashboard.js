import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { listDashboardWorkouts } from '../services/workoutsService'
import { describeFirestoreError } from '../utils/firestoreError'

export function useDashboard() {
  const { user } = useAuth()
  const [recentWorkouts, setRecentWorkouts] = useState([])
  const [allWorkouts, setAllWorkouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const workouts = await listDashboardWorkouts(user.uid)
      setRecentWorkouts(workouts.slice(0, 50))
      setAllWorkouts(workouts)
    } catch (err) {
      setError(describeFirestoreError(err, 'useDashboard'))
    } finally {
      setLoading(false)
    }
  }, [user.uid])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { recentWorkouts, allWorkouts, loading, error, refresh }
}

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { listRecentWorkouts, countWorkouts } from '../services/workoutsService'
import { describeFirestoreError } from '../utils/firestoreError'

const RECENT_WINDOW_SIZE = 50

export function useDashboard() {
  const { user } = useAuth()
  const [recentWorkouts, setRecentWorkouts] = useState([])
  const [totalWorkouts, setTotalWorkouts] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [workouts, total] = await Promise.all([
        listRecentWorkouts(user.uid, RECENT_WINDOW_SIZE),
        countWorkouts(user.uid),
      ])
      setRecentWorkouts(workouts)
      setTotalWorkouts(total)
    } catch (err) {
      setError(describeFirestoreError(err, 'useDashboard'))
    } finally {
      setLoading(false)
    }
  }, [user.uid])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { recentWorkouts, totalWorkouts, loading, error, refresh }
}

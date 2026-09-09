import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { listWorkoutsForExercise } from '../services/workoutsService'
import { describeFirestoreError } from '../utils/firestoreError'
import { getCached, setCached } from '../utils/pageCache'

export function useExerciseHistory(exerciseId) {
  const { user } = useAuth()
  const cacheKey = `exerciseHistory:${user.uid}:${exerciseId}`
  const cached = getCached(cacheKey)
  const [workouts, setWorkouts] = useState(cached || [])
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listWorkoutsForExercise(user.uid, exerciseId)
      setWorkouts(data)
      setCached(cacheKey, data)
    } catch (err) {
      setError(describeFirestoreError(err, 'useExerciseHistory'))
    } finally {
      setLoading(false)
    }
     
  }, [user.uid, exerciseId, cacheKey])

  useEffect(() => {
    if (!cached) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  return { workouts, loading, error, refresh }
}

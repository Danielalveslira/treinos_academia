import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { listWorkoutsForExercise } from '../services/workoutsService'
import { describeFirestoreError } from '../utils/firestoreError'

export function useExerciseHistory(exerciseId) {
  const { user } = useAuth()
  const [workouts, setWorkouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listWorkoutsForExercise(user.uid, exerciseId)
      setWorkouts(data)
    } catch (err) {
      setError(describeFirestoreError(err, 'useExerciseHistory'))
    } finally {
      setLoading(false)
    }
  }, [user.uid, exerciseId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { workouts, loading, error, refresh }
}

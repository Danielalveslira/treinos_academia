import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { listWorkoutsForExercise } from '../services/workoutsService'

export function useExerciseHistory(exerciseId) {
  const { user } = useAuth()
  const [workouts, setWorkouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listWorkoutsForExercise(user.uid, exerciseId)
      setWorkouts(data)
    } catch {
      setError('Não foi possível carregar o histórico do exercício.')
    } finally {
      setLoading(false)
    }
  }, [user.uid, exerciseId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { workouts, loading, error, refresh }
}

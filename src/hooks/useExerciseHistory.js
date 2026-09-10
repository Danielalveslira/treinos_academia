import { useCallback } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import { listWorkoutsForExercise } from '../services/workoutsService'

const EMPTY = []
export function useExerciseHistory(exerciseId) {
  const { user } = useAuth()
  const fetchValue = useCallback(
    () => (exerciseId ? listWorkoutsForExercise(user.uid, exerciseId) : Promise.resolve(EMPTY)),
    [user.uid, exerciseId]
  )
  const { data, loading, error, refresh } = useCachedQuery(
    `exerciseHistory:${user.uid}:${exerciseId}`,
    fetchValue
  )
  return { workouts: data || EMPTY, loading, error, refresh }
}

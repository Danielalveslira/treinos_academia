import { useCallback } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import { listWorkoutsForExercise } from '../services/workoutsService'

const EMPTY = []
export function useExerciseHistory(exerciseId) {
  const { user, offlineLocal } = useAuth()
  const fetchValue = useCallback(
    () =>
      exerciseId
        ? listWorkoutsForExercise(user.uid, exerciseId, undefined, { localOnly: offlineLocal })
        : Promise.resolve(EMPTY),
    [user.uid, exerciseId, offlineLocal]
  )
  const { data, loading, error, refresh } = useCachedQuery(
    `exerciseHistory:${user.uid}:${exerciseId}:${offlineLocal ? 'local' : 'online'}`,
    fetchValue
  )
  return { workouts: data || EMPTY, loading, error, refresh }
}

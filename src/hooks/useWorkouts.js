import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import {
  listWorkoutsPage,
  createWorkout,
  updateWorkout,
  deleteWorkout,
} from '../services/workoutsService'

export function useWorkouts(filters = {}) {
  const { user } = useAuth()
  const [workouts, setWorkouts] = useState([])
  const [cursor, setCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const { exerciseId, startDate, endDate } = filters

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { items, nextCursor } = await listWorkoutsPage(user.uid, {
        exerciseId,
        startDate,
        endDate,
      })
      setWorkouts(items)
      setCursor(nextCursor)
      setHasMore(!!nextCursor)
    } catch {
      setError('Não foi possível carregar o histórico.')
    } finally {
      setLoading(false)
    }
  }, [user.uid, exerciseId, startDate, endDate])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function loadMore() {
    if (!cursor) return
    try {
      const { items, nextCursor } = await listWorkoutsPage(user.uid, {
        exerciseId,
        startDate,
        endDate,
        cursor,
      })
      setWorkouts((prev) => [...prev, ...items])
      setCursor(nextCursor)
      setHasMore(!!nextCursor)
    } catch {
      setError('Não foi possível carregar mais registros.')
    }
  }

  async function add(workout) {
    await createWorkout(user.uid, workout)
    await refresh()
  }

  async function edit(workoutId, workout) {
    await updateWorkout(user.uid, workoutId, workout)
    await refresh()
  }

  async function remove(workoutId) {
    await deleteWorkout(user.uid, workoutId)
    await refresh()
  }

  return { workouts, loading, error, hasMore, loadMore, add, edit, remove, refresh }
}

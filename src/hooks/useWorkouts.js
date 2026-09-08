import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import {
  listWorkoutsPage,
  createWorkout,
  updateWorkout,
  deleteWorkout,
} from '../services/workoutsService'
import { describeFirestoreError } from '../utils/firestoreError'

export function useWorkouts(filters = {}) {
  const { user } = useAuth()
  const [workouts, setWorkouts] = useState([])
  const [cursor, setCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const { exerciseId, startDate, endDate } = filters

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { items, nextCursor } = await listWorkoutsPage(user.uid, {
        exerciseId,
        startDate,
        endDate,
      })
      setWorkouts(items)
      setCursor(nextCursor)
      setHasMore(!!nextCursor)
    } catch (err) {
      setError(describeFirestoreError(err, 'listWorkoutsPage'))
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
    } catch (err) {
      setError(describeFirestoreError(err, 'loadMore'))
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

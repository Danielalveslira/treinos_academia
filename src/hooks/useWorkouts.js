import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import {
  listWorkoutsPage,
  createWorkout,
  updateWorkout,
  deleteWorkout,
} from '../services/workoutsService'
import { describeFirestoreError } from '../utils/firestoreError'
import { getCached, setCached } from '../utils/pageCache'

export function useWorkouts(filters = {}) {
  const { user } = useAuth()
  const { exerciseId, startDate, endDate } = filters
  const cacheKey = `workouts:${user.uid}:${exerciseId || ''}:${startDate || ''}:${endDate || ''}`
  const cached = getCached(cacheKey)
  const [workouts, setWorkouts] = useState(cached?.items || [])
  const [cursor, setCursor] = useState(cached?.nextCursor || null)
  const [hasMore, setHasMore] = useState(!!cached?.nextCursor)
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState(null)

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
      setCached(cacheKey, { items, nextCursor })
    } catch (err) {
      setError(describeFirestoreError(err, 'listWorkoutsPage'))
    } finally {
      setLoading(false)
    }
     
  }, [user.uid, exerciseId, startDate, endDate, cacheKey])

  useEffect(() => {
    if (!cached) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setWorkouts((prev) => {
        const combined = [...prev, ...items]
        setCached(cacheKey, { items: combined, nextCursor })
        return combined
      })
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
    setWorkouts((prev) => {
      const next = prev.filter((w) => w.id !== workoutId)
      setCached(cacheKey, { items: next, nextCursor: cursor })
      return next
    })
  }

  return { workouts, loading, error, hasMore, loadMore, add, edit, remove, refresh }
}

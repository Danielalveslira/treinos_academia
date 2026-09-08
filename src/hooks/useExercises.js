import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import {
  listExercises,
  createExercise,
  updateExercise,
  deleteExercise,
} from '../services/exercisesService'
import { describeFirestoreError } from '../utils/firestoreError'

export function useExercises() {
  const { user } = useAuth()
  const [exercises, setExercises] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listExercises(user.uid)
      setExercises(data)
    } catch (err) {
      setError(describeFirestoreError(err, 'listExercises'))
    } finally {
      setLoading(false)
    }
  }, [user.uid])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function add(exercise) {
    await createExercise(user.uid, exercise)
    await refresh()
  }

  async function edit(exerciseId, exercise) {
    await updateExercise(user.uid, exerciseId, exercise)
    await refresh()
  }

  async function remove(exerciseId) {
    await deleteExercise(user.uid, exerciseId)
    await refresh()
  }

  return { exercises, loading, error, add, edit, remove, refresh }
}

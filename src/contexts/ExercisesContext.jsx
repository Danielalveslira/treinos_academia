import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  listExercises,
  createExercise,
  updateExercise,
  deleteExercise,
} from '../services/exercisesService'
import { describeFirestoreError } from '../utils/firestoreError'

const ExercisesContext = createContext(null)

function byName(a, b) {
  return a.name.localeCompare(b.name)
}

function normalize(exercise) {
  return {
    name: exercise.name.trim(),
    muscleGroup: exercise.muscleGroup,
    note: exercise.note?.trim() || '',
  }
}

export function ExercisesProvider({ children }) {
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
    const docRef = await createExercise(user.uid, exercise)
    const created = { id: docRef.id, ...normalize(exercise), active: true }
    setExercises((prev) => [...prev, created].sort(byName))
  }

  async function edit(exerciseId, exercise) {
    await updateExercise(user.uid, exerciseId, exercise)
    setExercises((prev) =>
      prev
        .map((ex) =>
          ex.id === exerciseId ? { ...ex, ...normalize(exercise), active: exercise.active } : ex
        )
        .sort(byName)
    )
  }

  async function remove(exerciseId) {
    await deleteExercise(user.uid, exerciseId)
    setExercises((prev) => prev.filter((ex) => ex.id !== exerciseId))
  }

  return (
    <ExercisesContext.Provider value={{ exercises, loading, error, add, edit, remove, refresh }}>
      {children}
    </ExercisesContext.Provider>
  )
}

export function useExercises() {
  const context = useContext(ExercisesContext)
  if (!context) throw new Error('useExercises deve ser usado dentro de ExercisesProvider')
  return context
}

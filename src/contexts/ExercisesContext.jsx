import { createContext, useCallback, useContext } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  listExercises,
  createExercise,
  updateExercise,
  deleteExercise,
} from '../services/exercisesService'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { getExerciseType } from '../utils/exerciseType'

const EMPTY = []

const ExercisesContext = createContext(null)

function byName(a, b) {
  return a.name.localeCompare(b.name)
}

function normalize(exercise) {
  return {
    name: exercise.name.trim(),
    muscleGroup: exercise.muscleGroup.trim(),
    type: getExerciseType(exercise),
    note: exercise.note?.trim() || '',
  }
}

export function ExercisesProvider({ children }) {
  const { user } = useAuth()
  const fetchValue = useCallback(() => listExercises(user.uid), [user.uid])
  const { data, loading, error, refresh, setData } = useCachedQuery(
    `exercises:${user.uid}`,
    fetchValue
  )
  const exercises = data || EMPTY

  async function add(exercise) {
    const docRef = await createExercise(user.uid, exercise)
    const created = { id: docRef.id, ...normalize(exercise), active: true }
    setData([...exercises, created].sort(byName))
  }

  async function edit(exerciseId, exercise) {
    await updateExercise(user.uid, exerciseId, exercise)
    setData(
      exercises
        .map((ex) =>
          ex.id === exerciseId ? { ...ex, ...normalize(exercise), active: exercise.active } : ex
        )
        .sort(byName)
    )
  }

  async function remove(exerciseId) {
    await deleteExercise(user.uid, exerciseId)
    setData(exercises.filter((ex) => ex.id !== exerciseId))
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

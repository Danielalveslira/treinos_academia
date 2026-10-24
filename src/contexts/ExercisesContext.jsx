import { createContext, useCallback, useContext, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  listExercises,
  createCatalogExercise,
  updateExercise,
  deleteExercise,
  saveExerciseOrder,
} from '../services/exercisesService'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { providerExerciseToPersonal, isProviderExerciseAdded } from '../utils/exerciseCatalog.js'

const EMPTY = []

const ExercisesContext = createContext(null)

function byName(a, b) {
  return a.name.localeCompare(b.name)
}

export function ExercisesProvider({ children, enabled = true }) {
  const { user, offlineLocal } = useAuth()
  const fetchValue = useCallback(
    () => listExercises(user.uid, { localOnly: offlineLocal }),
    [user.uid, offlineLocal]
  )
  const { data, loading, error, refresh, setData } = useCachedQuery(
    `exercises:${user.uid}:${offlineLocal ? 'local' : 'online'}`,
    fetchValue,
    { keepPreviousScope: user.uid, enabled }
  )
  const exercises = data || EMPTY
  const exercisesRef = useRef({ userId: user.uid, data: exercises })
  exercisesRef.current = { userId: user.uid, data: exercises }
  function changeExercises(update) {
    if (exercisesRef.current.userId !== user.uid) return
    const next = update(exercisesRef.current.data)
    exercisesRef.current.data = next
    setData(next)
  }

  // catalogExercise vem no formato de resposta do nosso catálogo (id do catálogo,
  // providerExerciseId, name, primaryMuscles, equipment, category, ...) — ver
  // exerciseCatalogService.searchExercises.
  async function addFromCatalog(catalogExercise) {
    if (
      isProviderExerciseAdded(
        exercises,
        catalogExercise.providerExerciseId,
        catalogExercise.provider || 'evolutus_dataset'
      )
    )
      return { added: false }
    const group = providerExerciseToPersonal(catalogExercise).muscleGroup
    const groupOrders = exercises
      .filter((exercise) => exercise.muscleGroup === group && Number.isInteger(exercise.order))
      .map((exercise) => exercise.order)
    const order = groupOrders.length ? Math.min(299, Math.max(...groupOrders) + 1) : 0
    const personalExercise = providerExerciseToPersonal(catalogExercise, { order })
    const result = await createCatalogExercise(user.uid, personalExercise)
    changeExercises((current) =>
      [...(current || []).filter((item) => item.id !== result.exercise.id), result.exercise].sort(
        byName
      )
    )
    return result
  }

  async function edit(exerciseId, exercise) {
    const preferences = {
      ...(Object.hasOwn(exercise, 'note') ? { note: exercise.note?.trim() || '' } : {}),
      ...(Object.hasOwn(exercise, 'active') ? { active: exercise.active } : {}),
    }
    await updateExercise(user.uid, exerciseId, preferences)
    changeExercises((current) =>
      (current || []).map((item) => (item.id === exerciseId ? { ...item, ...preferences } : item))
    )
  }

  async function remove(exerciseId) {
    await deleteExercise(user.uid, exerciseId)
    changeExercises((current) => current.filter((ex) => ex.id !== exerciseId))
  }

  // orderedIds: todos os exercícios de UM grupo muscular, na ordem desejada.
  // Só grava no banco se a ordem proposta for diferente da já salva — evita
  // uma escrita em branco quando o usuário entra e sai do modo "Reordenar" sem
  // mudar nada.
  async function reorder(orderedIds) {
    const unchanged = orderedIds.every((id, index) => {
      const current = exercises.find((ex) => ex.id === id)
      return current?.order === index
    })
    if (unchanged) return
    await saveExerciseOrder(user.uid, orderedIds)
    const orderById = new Map(orderedIds.map((id, index) => [id, index]))
    changeExercises((current) =>
      current
        .map((ex) => (orderById.has(ex.id) ? { ...ex, order: orderById.get(ex.id) } : ex))
        .sort(byName)
    )
  }

  return (
    <ExercisesContext.Provider
      value={{ exercises, loading, error, addFromCatalog, edit, remove, reorder, refresh }}
    >
      {children}
    </ExercisesContext.Provider>
  )
}

export function useExercises() {
  const context = useContext(ExercisesContext)
  if (!context) throw new Error('useExercises deve ser usado dentro de ExercisesProvider')
  return context
}

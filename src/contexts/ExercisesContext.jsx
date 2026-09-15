import { createContext, useCallback, useContext } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  listExercises,
  createExercise,
  createCatalogExercise,
  updateExercise,
  deleteExercise,
  saveExerciseOrder,
} from '../services/exercisesService'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { getExerciseType } from '../utils/exerciseType'
import { catalogExerciseToPersonal, isCatalogExerciseAdded } from '../utils/exerciseCatalog.js'

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
    ...(exercise.source ? { source: exercise.source } : {}),
    ...(Object.hasOwn(exercise, 'catalogExerciseId')
      ? { catalogExerciseId: exercise.catalogExerciseId }
      : {}),
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
    const created = {
      id: docRef.id,
      ...normalize(exercise),
      active: true,
      source: 'custom',
      catalogExerciseId: null,
    }
    setData([...exercises, created].sort(byName))
  }

  async function addFromCatalog(catalogExercise) {
    if (isCatalogExerciseAdded(exercises, catalogExercise.id)) return { added: false }
    const group = catalogExerciseToPersonal(catalogExercise).muscleGroup
    const groupOrders = exercises
      .filter((exercise) => exercise.muscleGroup === group && Number.isInteger(exercise.order))
      .map((exercise) => exercise.order)
    const order = groupOrders.length ? Math.min(299, Math.max(...groupOrders) + 1) : 0
    const personalExercise = catalogExerciseToPersonal(catalogExercise, { order })
    const id = await createCatalogExercise(user.uid, personalExercise)
    setData([...exercises, { id, ...personalExercise }].sort(byName))
    return { added: true, exercise: { id, ...personalExercise } }
  }

  async function edit(exerciseId, exercise) {
    const current = exercises.find((ex) => ex.id === exerciseId)
    // A posição salva por "Reordenar exercícios" só vale dentro do grupo em que
    // foi definida — trocando de grupo, ela deixa de fazer sentido e precisa ser
    // limpa dos dois lados (ver updateExercise/clearOrder), senão o exercício
    // herda uma posição arbitrária do grupo anterior no grupo novo.
    const groupChanged = current && current.muscleGroup !== exercise.muscleGroup.trim()
    await updateExercise(user.uid, exerciseId, exercise, { clearOrder: groupChanged })
    setData(
      exercises
        .map((ex) => {
          if (ex.id !== exerciseId) return ex
          const { order: _order, ...withoutOrder } = ex
          const base = groupChanged ? withoutOrder : ex
          return { ...base, ...normalize(exercise), active: exercise.active }
        })
        .sort(byName)
    )
  }

  async function remove(exerciseId) {
    await deleteExercise(user.uid, exerciseId)
    setData(exercises.filter((ex) => ex.id !== exerciseId))
  }

  // orderedIds: todos os exercícios de UM grupo muscular, na ordem desejada.
  // Só grava no Firestore se a ordem proposta for diferente da já salva — evita
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
    setData(
      exercises
        .map((ex) => (orderById.has(ex.id) ? { ...ex, order: orderById.get(ex.id) } : ex))
        .sort(byName)
    )
  }

  return (
    <ExercisesContext.Provider
      value={{ exercises, loading, error, add, addFromCatalog, edit, remove, reorder, refresh }}
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

import {
  addSet,
  canRemoveSet,
  commitSetEdit,
  concludeSet,
  dropPendingSets,
  nextPendingIndex,
  removeSet,
  updateSetField,
} from '../../utils/setSession.js'
import { isValidSet } from '../../utils/workoutSets.js'

export const DEMO_SHEET_NAME = 'Treino A — Peito e Tríceps'

export const DEMO_EXERCISES = [
  {
    id: 'demo-supino-reto',
    name: 'Supino reto com barra',
    group: 'Peito',
    previous: [
      [60, 10],
      [60, 9],
      [57.5, 10],
    ],
  },
  {
    id: 'demo-supino-inclinado',
    name: 'Supino inclinado com halteres',
    group: 'Peito',
    previous: [
      [22, 12],
      [24, 10],
      [24, 9],
    ],
  },
  {
    id: 'demo-crucifixo',
    name: 'Crucifixo na máquina',
    group: 'Peito',
    previous: [
      [35, 12],
      [40, 10],
      [40, 8],
    ],
  },
  {
    id: 'demo-triceps',
    name: 'Tríceps na polia',
    group: 'Tríceps',
    previous: [
      [30, 12],
      [35, 10],
      [35, 9],
    ],
  },
]

export function initialDemoState() {
  return {
    exercises: DEMO_EXERCISES.map((exercise) => ({
      ...exercise,
      sets: exercise.previous.map(([weight, reps], index) => ({
        key: `${exercise.id}-${index}`,
        historyIndex: index,
        weight: String(weight),
        reps: String(reps),
        source: 'history',
        done: false,
        committed: null,
        suggested: { weight: String(weight), reps: String(reps) },
      })),
    })),
    openId: DEMO_EXERCISES[0].id,
    active: {},
    reviewingId: null,
    summary: false,
    nextKey: 20,
  }
}

export function demoTotals(state) {
  const all = state.exercises.flatMap((exercise) => exercise.sets)
  const done = all.filter((set) => set.done && isValidSet(set.committed))
  const completedExercises = state.exercises.filter(
    (exercise) => exercise.sets.length > 0 && exercise.sets.every((set) => set.done)
  ).length
  const volume = done.reduce(
    (sum, set) => sum + Number(set.committed.weight) * Number(set.committed.reps),
    0
  )
  // Comparar apenas posições concluídas na demonstração com as mesmas posições da ficha exemplo.
  const previousComparable = state.exercises.reduce(
    (sum, exercise) =>
      sum +
      exercise.sets.reduce((setSum, set, index) => {
        if (!set.done || !isValidSet(set.committed)) return setSum
        const previous = exercise.previous[set.historyIndex ?? index]
        return previous ? setSum + previous[0] * previous[1] : setSum
      }, 0),
    0
  )
  const comparableCount = state.exercises.reduce(
    (sum, exercise) =>
      sum +
      exercise.sets.filter(
        (set, index) =>
          set.done && isValidSet(set.committed) && exercise.previous[set.historyIndex ?? index]
      ).length,
    0
  )
  return {
    done: done.length,
    planned: all.length,
    completedExercises,
    plannedExercises: state.exercises.length,
    volume,
    // Uma série adicionada não tem histórico correspondente: a comparação deixa de ser honesta.
    comparisonPercent:
      done.length > 0 && comparableCount === done.length && previousComparable > 0
        ? Math.round(((volume - previousComparable) / previousComparable) * 100)
        : null,
  }
}

function changeExercise(state, id, update) {
  return {
    ...state,
    exercises: state.exercises.map((exercise) =>
      exercise.id === id ? { ...exercise, sets: update(exercise.sets) } : exercise
    ),
  }
}

export function demoReducer(state, action) {
  if (action.type === 'reset') return initialDemoState()
  if (action.type === 'summary') return demoTotals(state).done ? { ...state, summary: true } : state
  if (action.type === 'open') return { ...state, openId: action.id, reviewingId: null }
  if (action.type === 'review') return { ...state, openId: action.id, reviewingId: action.id }
  if (action.type === 'select')
    return { ...state, active: { ...state.active, [action.id]: action.index } }
  const exercise = state.exercises.find((item) => item.id === action.id)
  if (!exercise) return state
  const index = Math.min(state.active[action.id] || 0, exercise.sets.length - 1)
  const key = exercise.sets[index]?.key
  if (action.type === 'field')
    return changeExercise(state, action.id, (sets) =>
      updateSetField(sets, key, action.field, action.value)
    )
  if (action.type === 'conclude') {
    const result = concludeSet(exercise.sets, index)
    if (!result) return state
    const next = changeExercise(state, action.id, () => result.sets)
    return {
      ...next,
      active: { ...next.active, [action.id]: result.nextIndex < 0 ? index : result.nextIndex },
      reviewingId: result.finished ? null : state.reviewingId,
    }
  }
  if (action.type === 'commit') {
    const updated = commitSetEdit(exercise.sets, index)
    return updated ? changeExercise(state, action.id, () => updated) : state
  }
  if (action.type === 'finishExercise') return changeExercise(state, action.id, dropPendingSets)
  if (action.type === 'undo')
    return changeExercise(state, action.id, (sets) =>
      sets.map((set, position) =>
        position === index ? { ...set, done: false, committed: null } : set
      )
    )
  if (action.type === 'add') {
    const updated = addSet(exercise.sets, () => `${exercise.id}-${state.nextKey}`)
    if (updated === exercise.sets) return state
    return {
      ...changeExercise(state, action.id, () => updated),
      nextKey: state.nextKey + 1,
      reviewingId: action.id,
    }
  }
  if (action.type === 'remove') {
    if (!canRemoveSet(exercise.sets, key)) return state
    const updated = removeSet(exercise.sets, key)
    const next = changeExercise(state, action.id, () => updated)
    return {
      ...next,
      active: { ...next.active, [action.id]: Math.max(0, nextPendingIndex(updated, -1)) },
      reviewingId: action.id,
    }
  }
  return state
}

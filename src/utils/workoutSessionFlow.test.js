import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextStepAfterFinishing, valuesForNextExercise } from './workoutSessionFlow.js'
import { loadDoneExerciseIds, saveDoneExerciseIds } from './doneExercisesStorage.js'

function fakeLocalStorage() {
  const store = new Map()
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
  }
}

test('goes back to the exercise list when the group still has undone exercises', () => {
  const result = nextStepAfterFinishing({
    allExercisesInGroup: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    doneExerciseIds: new Set(['a']),
    finishedExerciseId: 'b',
  })
  assert.equal(result.step, 'exercise')
  assert.deepEqual([...result.doneExerciseIds].sort(), ['a', 'b'])
})

test('goes back to the group list once every exercise in the group is done', () => {
  const result = nextStepAfterFinishing({
    allExercisesInGroup: [{ id: 'a' }, { id: 'b' }],
    doneExerciseIds: new Set(['a']),
    finishedExerciseId: 'b',
  })
  assert.equal(result.step, 'group')
  assert.deepEqual([...result.doneExerciseIds].sort(), ['a', 'b'])
})

test('a single-exercise group goes straight back to the group list', () => {
  const result = nextStepAfterFinishing({
    allExercisesInGroup: [{ id: 'only' }],
    doneExerciseIds: new Set(),
    finishedExerciseId: 'only',
  })
  assert.equal(result.step, 'group')
})

test('re-finishing an already-done exercise does not change the outcome', () => {
  const result = nextStepAfterFinishing({
    allExercisesInGroup: [{ id: 'a' }, { id: 'b' }],
    doneExerciseIds: new Set(['a', 'b']),
    finishedExerciseId: 'a',
  })
  assert.equal(result.step, 'group')
  assert.deepEqual([...result.doneExerciseIds].sort(), ['a', 'b'])
})

test('does not mutate the doneExerciseIds Set passed in', () => {
  const original = new Set(['a'])
  nextStepAfterFinishing({
    allExercisesInGroup: [{ id: 'a' }, { id: 'b' }],
    doneExerciseIds: original,
    finishedExerciseId: 'b',
  })
  assert.deepEqual([...original], ['a'])
})

// Composição com o storage por trás: exercícios já concluídos hoje (carregados do
// localStorage) contam pra decisão, exatamente como aconteceria de verdade em
// WorkoutForm.jsx (loadDoneExerciseIds no mount, nextStepAfterFinishing ao finalizar).
test('composes with storage: exercises already done today count toward the decision', () => {
  globalThis.localStorage = fakeLocalStorage()
  saveDoneExerciseIds('2026-09-12', new Set(['a']))

  const loaded = loadDoneExerciseIds('2026-09-12')
  const result = nextStepAfterFinishing({
    allExercisesInGroup: [{ id: 'a' }, { id: 'b' }],
    doneExerciseIds: loaded,
    finishedExerciseId: 'b',
  })

  assert.equal(result.step, 'group')
  delete globalThis.localStorage
})

// Bug de produção: observação (e, em tese, peso/reps) do exercício A vazando pro
// formulário do exercício B depois de "Finalizar exercício" voltar automaticamente pra
// aba "2 Exercício" -- só passou a acontecer depois que WorkoutForm ficou montado entre
// exercícios (antes, finalizar sempre navegava pra fora da página).
test('valuesForNextExercise clears note, exercise selection and sets, but keeps the session date', () => {
  const previous = {
    exerciseId: 'ex1',
    note: 'senti dor no ombro',
    date: '2026-08-01',
    durationMinutes: '30',
    distanceKm: '5',
    setDetails: [{ weight: '40', reps: '10', key: 7 }],
  }
  const result = valuesForNextExercise(previous)
  assert.equal(result.note, '', 'observação não deveria vazar pro próximo exercício')
  assert.equal(result.exerciseId, '')
  assert.equal(result.durationMinutes, '')
  assert.equal(result.distanceKm, '')
  assert.deepEqual(result.setDetails, [{ weight: '', reps: '' }])
  assert.equal(result.date, '2026-08-01', 'data é da sessão inteira, deve persistir')
})

test('valuesForNextExercise with an empty note stays empty (no false positive)', () => {
  const result = valuesForNextExercise({ note: '', date: '2026-09-12' })
  assert.equal(result.note, '')
})

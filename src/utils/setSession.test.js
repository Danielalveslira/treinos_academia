import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SET_COUNT,
  addSet,
  aggregateSyncStatus,
  buildEditSets,
  buildSessionSets,
  canRemoveSet,
  commitSetEdit,
  concludeSet,
  doneSetsPayload,
  dropPendingSets,
  isSetDirty,
  nextPendingIndex,
  removeSet,
  setSourceLabel,
  setSyncStatus,
  setValueKey,
  updateSetField,
} from './setSession.js'

const counter = () => {
  let key = 0
  return () => key++
}
const history = {
  setDetails: [
    { weight: 20, reps: 10 },
    { weight: 22.5, reps: 8 },
  ],
}

test('without history there is a default number of empty sets and no invented values', () => {
  const sets = buildSessionSets(undefined, counter())
  assert.equal(sets.length, DEFAULT_SET_COUNT)
  for (const set of sets) {
    assert.deepEqual(
      [set.weight, set.reps, set.source, set.done, set.committed, set.suggested],
      ['', '', 'empty', false, null, null]
    )
  }
})

test('history becomes labelled suggestions — never completed sets', () => {
  const sets = buildSessionSets(history, counter())
  assert.deepEqual(
    sets.map((set) => [set.weight, set.reps, set.source]),
    [
      ['20', '10', 'history'],
      ['22.5', '8', 'history'],
    ]
  )
  assert.ok(sets.every((set) => !set.done && set.committed === null))
  assert.equal(setSourceLabel(sets[0]), 'Sugerido do último treino')
})

test('concluding validates, marks done, advances and finishes only when nothing is pending', () => {
  const sets = buildSessionSets(undefined, counter())
  assert.equal(concludeSet(sets, 0), null) // vazia não conclui
  const filled = updateSetField(updateSetField(sets, 0, 'weight', '20'), 0, 'reps', '10')
  const first = concludeSet(filled, 0)
  assert.equal(first.nextIndex, 1)
  assert.equal(first.finished, false)
  assert.equal(first.sets[0].done, true)
  assert.deepEqual(first.sets[0].committed, { weight: '20', reps: '10' })
  // Toque repetido na mesma série não conclui de novo.
  assert.equal(concludeSet(first.sets, 0), null)
  const second = concludeSet(first.sets, 1)
  assert.equal(second.nextIndex, 2)
  const third = concludeSet(second.sets, 2)
  assert.equal(third.finished, true)
  assert.equal(third.nextIndex, -1)
})

test('next sets inherit the previous values; typed values are never overwritten', () => {
  let sets = buildSessionSets(undefined, counter())
  sets = updateSetField(updateSetField(sets, 2, 'weight', '50'), 2, 'reps', '5') // digitou adiante
  sets = updateSetField(updateSetField(sets, 0, 'weight', '20'), 0, 'reps', '10')
  const { sets: next } = concludeSet(sets, 0)
  assert.deepEqual([next[1].weight, next[1].reps, next[1].source], ['20', '10', 'inherited'])
  assert.deepEqual([next[2].weight, next[2].reps, next[2].source], ['50', '5', 'manual'])
  assert.equal(setSourceLabel(next[1]), 'Igual à série anterior')
})

test('history progression is kept when the suggestion is confirmed and replaced when the user deviates', () => {
  const kept = concludeSet(buildSessionSets(history, counter()), 0)
  assert.equal(kept.sets[1].weight, '22.5')
  assert.equal(kept.sets[1].source, 'history')

  const base = buildSessionSets(history, counter())
  const deviated = concludeSet(updateSetField(base, 0, 'weight', '30'), 0)
  assert.deepEqual(
    [deviated.sets[1].weight, deviated.sets[1].reps, deviated.sets[1].source],
    ['30', '10', 'inherited']
  )
})

test('bodyweight / zero load is valid', () => {
  const sets = updateSetField(
    updateSetField(buildSessionSets(undefined, counter()), 0, 'weight', '0'),
    0,
    'reps',
    '12'
  )
  assert.equal(concludeSet(sets, 0).sets[0].committed.weight, '0')
})

test('nextPendingIndex wraps around to earlier pending sets', () => {
  const sets = [{ done: false }, { done: true }, { done: true }]
  assert.equal(nextPendingIndex(sets, 2), 0)
  assert.equal(nextPendingIndex(sets, -1), 0)
  assert.equal(nextPendingIndex([{ done: true }], 0), -1)
})

test('editing a recorded set is dirty until committed and never touches the other sets', () => {
  let sets = buildEditSets(
    [
      { weight: 30, reps: 12 },
      { weight: 40, reps: 8 },
    ],
    counter()
  )
  assert.equal(isSetDirty(sets[0]), false)
  sets = updateSetField(sets, sets[0].key, 'weight', '32,5'.replace(',', '.'))
  assert.equal(isSetDirty(sets[0]), true)
  // O que seria salvo continua sendo o valor registrado até confirmar.
  assert.deepEqual(
    doneSetsPayload(sets).map((set) => set.weight),
    ['30', '40']
  )
  const committed = commitSetEdit(sets, 0)
  assert.deepEqual(
    doneSetsPayload(committed).map((set) => [set.weight, set.reps]),
    [
      ['32.5', '12'],
      ['40', '8'],
    ]
  )
  assert.equal(isSetDirty(committed[0]), false)
  // Voltar ao mesmo valor numérico não é alteração.
  assert.equal(isSetDirty(updateSetField(committed, committed[0].key, 'weight', '32.50')), false)
})

test('add / remove / finish-now keep the recorded sets safe', () => {
  const next = counter()
  let sets = buildSessionSets(undefined, next)
  sets = updateSetField(updateSetField(sets, 0, 'weight', '20'), 0, 'reps', '10')
  sets = concludeSet(sets, 0).sets
  assert.equal(canRemoveSet(sets, sets[0].key), false) // única concluída
  assert.equal(canRemoveSet(sets, sets[1].key), true)
  assert.equal(removeSet(sets, sets[0].key), sets)
  assert.equal(dropPendingSets(sets).length, 1)
  assert.equal(addSet(sets, next).length, 4)
  assert.equal(canRemoveSet([sets[0]], sets[0].key), false) // nunca fica sem séries
  const full = Array.from({ length: 10 }, () => sets[0])
  assert.equal(addSet(full, next), full) // teto de séries (workouts_sets_match)
  const untouched = buildSessionSets(undefined, next)
  assert.equal(dropPendingSets(untouched), untouched) // sem concluídas, nada é descartado
})

test('save status per set follows what the row has actually persisted', () => {
  const done = { key: 1, done: true, committed: { weight: '20', reps: '10' } }
  assert.equal(setSyncStatus({ ...done, done: false }, {}), null)
  assert.equal(setSyncStatus(done, undefined), 'saving')
  assert.equal(setSyncStatus(done, { status: 'saving', persisted: {} }), 'saving')
  assert.equal(setSyncStatus(done, { status: 'error', persisted: {} }), 'error')
  const persisted = { [done.key]: setValueKey(done.committed) }
  assert.equal(setSyncStatus(done, { status: 'saved', persisted }), 'saved')
  assert.equal(setSyncStatus(done, { status: 'saved', persisted, pendingSync: true }), 'local')
  // Valor editado e ainda não gravado não herda o "salvo" do valor antigo.
  assert.equal(
    setSyncStatus(
      { ...done, committed: { weight: '25', reps: '10' } },
      { status: 'saved', persisted }
    ),
    'saving'
  )
  assert.equal(aggregateSyncStatus(['saved', 'local', 'saving']), 'saving')
  assert.equal(aggregateSyncStatus(['saved', 'error']), 'error')
  assert.equal(aggregateSyncStatus([null, null]), null)
})

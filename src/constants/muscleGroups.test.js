import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MUSCLE_GROUPS, mergeCustomGroups, resolveMuscleGroup } from './muscleGroups.js'

test('mergeCustomGroups keeps the fixed list and appends groups actually used, sorted', () => {
  const exercises = [
    { muscleGroup: 'Peito' },
    { muscleGroup: 'Explosão' },
    { muscleGroup: 'Alongamento' },
  ]
  const result = mergeCustomGroups(exercises)
  assert.deepEqual(result.slice(0, MUSCLE_GROUPS.length), MUSCLE_GROUPS)
  assert.deepEqual(result.slice(MUSCLE_GROUPS.length), ['Alongamento', 'Explosão'])
})

test('mergeCustomGroups never duplicates a fixed group by different casing, and ignores blanks', () => {
  const exercises = [{ muscleGroup: 'cardio' }, { muscleGroup: '  ' }, { muscleGroup: null }]
  assert.deepEqual(mergeCustomGroups(exercises), MUSCLE_GROUPS)
})

test('mergeCustomGroups dedupes a custom group used by several exercises, keeping first-seen casing', () => {
  const exercises = [
    { muscleGroup: 'Explosão' },
    { muscleGroup: 'explosão' },
    { muscleGroup: 'EXPLOSÃO' },
  ]
  assert.deepEqual(mergeCustomGroups(exercises).slice(MUSCLE_GROUPS.length), ['Explosão'])
})

test('mergeCustomGroups defaults to the fixed list alone with no exercises', () => {
  assert.deepEqual(mergeCustomGroups(), MUSCLE_GROUPS)
  assert.deepEqual(mergeCustomGroups([]), MUSCLE_GROUPS)
})

test('resolveMuscleGroup snaps a typed group to the canonical casing of an existing one', () => {
  const groups = mergeCustomGroups([{ muscleGroup: 'Explosão' }])
  assert.equal(resolveMuscleGroup('peito', groups), 'Peito')
  assert.equal(resolveMuscleGroup('  CARDIO  ', groups), 'Cardio')
  assert.equal(resolveMuscleGroup('explosão', groups), 'Explosão')
  // Sem correspondência: mantém o texto digitado (trimado), é um grupo novo de verdade.
  assert.equal(resolveMuscleGroup('  Mobilidade  ', groups), 'Mobilidade')
})

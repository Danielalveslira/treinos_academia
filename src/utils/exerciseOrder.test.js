import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortExercisesInGroup, moveExerciseOrder } from './exerciseOrder.js'

test('with no exercise having `order`, falls back to the existing alphabetical behavior', () => {
  const result = sortExercisesInGroup([{ name: 'Supino inclinado' }, { name: 'Crucifixo' }, { name: 'Supino reto' }])
  assert.deepEqual(result.map((e) => e.name), ['Crucifixo', 'Supino inclinado', 'Supino reto'])
})

test('exercises with `order` come first (ascending), unordered ones after, alphabetically', () => {
  const result = sortExercisesInGroup([
    { id: 'c', name: 'Crucifixo' },
    { id: 'a', name: 'Supino reto', order: 1 },
    { id: 'b', name: 'Supino inclinado', order: 0 },
    { id: 'd', name: 'Agachamento no cabo' },
  ])
  assert.deepEqual(result.map((e) => e.id), ['b', 'a', 'd', 'c'])
})

test('does not mutate the array passed in', () => {
  const original = [{ name: 'b' }, { name: 'a' }]
  sortExercisesInGroup(original)
  assert.deepEqual(original.map((e) => e.name), ['b', 'a'])
})

test('moveExerciseOrder swaps with the previous id when moving up', () => {
  const result = moveExerciseOrder(['a', 'b', 'c'], 'b', -1)
  assert.deepEqual(result, ['b', 'a', 'c'])
})

test('moveExerciseOrder swaps with the next id when moving down', () => {
  const result = moveExerciseOrder(['a', 'b', 'c'], 'b', 1)
  assert.deepEqual(result, ['a', 'c', 'b'])
})

test('moveExerciseOrder is a no-op when the id is already first and moving up', () => {
  const result = moveExerciseOrder(['a', 'b', 'c'], 'a', -1)
  assert.deepEqual(result, ['a', 'b', 'c'])
})

test('moveExerciseOrder is a no-op when the id is already last and moving down', () => {
  const result = moveExerciseOrder(['a', 'b', 'c'], 'c', 1)
  assert.deepEqual(result, ['a', 'b', 'c'])
})

test('moveExerciseOrder is a no-op for an id that is not in the list', () => {
  const result = moveExerciseOrder(['a', 'b', 'c'], 'z', 1)
  assert.deepEqual(result, ['a', 'b', 'c'])
})

test('moveExerciseOrder does not mutate the array passed in', () => {
  const original = ['a', 'b', 'c']
  moveExerciseOrder(original, 'b', 1)
  assert.deepEqual(original, ['a', 'b', 'c'])
})

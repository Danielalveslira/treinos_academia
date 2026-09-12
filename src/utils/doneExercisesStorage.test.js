import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadDoneExerciseIds,
  saveDoneExerciseIds,
  cleanupStaleDoneExerciseKeys,
} from './doneExercisesStorage.js'

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

beforeEach(() => {
  delete globalThis.localStorage
})

// Sem mock nenhum: localStorage nem existe no escopo global do runner de testes Node --
// é exatamente o cenário "storage indisponível" (modo privado agressivo, quota cheia)
// que o try/catch precisa cobrir.
test('loadDoneExerciseIds returns an empty Set when localStorage is unavailable', () => {
  assert.deepEqual(loadDoneExerciseIds('2026-09-12'), new Set())
})

test('saveDoneExerciseIds does not throw when localStorage is unavailable', () => {
  assert.doesNotThrow(() => saveDoneExerciseIds('2026-09-12', new Set(['ex1'])))
})

test('cleanupStaleDoneExerciseKeys does not throw when localStorage is unavailable', () => {
  assert.doesNotThrow(() => cleanupStaleDoneExerciseKeys('2026-09-12'))
})

test('save then load round-trips the same ids for the same day', () => {
  globalThis.localStorage = fakeLocalStorage()
  saveDoneExerciseIds('2026-09-12', new Set(['ex1', 'ex2']))
  assert.deepEqual([...loadDoneExerciseIds('2026-09-12')].sort(), ['ex1', 'ex2'])
})

test('a different day key reads as empty, even with another day already saved', () => {
  globalThis.localStorage = fakeLocalStorage()
  saveDoneExerciseIds('2026-09-12', new Set(['ex1']))
  assert.deepEqual(loadDoneExerciseIds('2026-09-13'), new Set())
})

test('malformed stored JSON degrades to an empty Set instead of throwing', () => {
  globalThis.localStorage = fakeLocalStorage()
  globalThis.localStorage.setItem('evolutus:done-exercises:2026-09-12', 'not json')
  assert.deepEqual(loadDoneExerciseIds('2026-09-12'), new Set())
})

test('a non-array stored value degrades to an empty Set instead of throwing', () => {
  globalThis.localStorage = fakeLocalStorage()
  globalThis.localStorage.setItem('evolutus:done-exercises:2026-09-12', JSON.stringify({ not: 'an array' }))
  assert.deepEqual(loadDoneExerciseIds('2026-09-12'), new Set())
})

test('cleanupStaleDoneExerciseKeys removes other days but keeps the current one', () => {
  globalThis.localStorage = fakeLocalStorage()
  saveDoneExerciseIds('2026-09-10', new Set(['old1']))
  saveDoneExerciseIds('2026-09-11', new Set(['old2']))
  saveDoneExerciseIds('2026-09-12', new Set(['today1']))
  cleanupStaleDoneExerciseKeys('2026-09-12')
  assert.deepEqual(loadDoneExerciseIds('2026-09-10'), new Set())
  assert.deepEqual(loadDoneExerciseIds('2026-09-11'), new Set())
  assert.deepEqual([...loadDoneExerciseIds('2026-09-12')], ['today1'])
})

test('cleanupStaleDoneExerciseKeys leaves unrelated keys untouched', () => {
  globalThis.localStorage = fakeLocalStorage()
  globalThis.localStorage.setItem('colorMode', 'night')
  saveDoneExerciseIds('2026-09-10', new Set(['old1']))
  cleanupStaleDoneExerciseKeys('2026-09-12')
  assert.equal(globalThis.localStorage.getItem('colorMode'), 'night')
})

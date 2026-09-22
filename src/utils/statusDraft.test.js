import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearStatusDraft,
  readStatusDraft,
  saveStatusDraft,
  statusDraftKey,
} from './statusDraft.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

test('draft keys isolate user, community and publication type', () => {
  assert.notEqual(statusDraftKey('u1', 'c1', 'text'), statusDraftKey('u2', 'c1', 'text'))
  assert.notEqual(statusDraftKey('u1', 'c1', 'text'), statusDraftKey('u1', 'c2', 'text'))
  assert.notEqual(statusDraftKey('u1', 'c1', 'text'), statusDraftKey('u1', 'c1', 'poll'))
  assert.equal(statusDraftKey(null, 'c1', 'text'), null)
})

test('draft is restored only from its exact scoped key and cleared after success', () => {
  const storage = memoryStorage()
  saveStatusDraft('u1', 'c1', 'text', 'meu rascunho', storage)
  assert.equal(readStatusDraft('u1', 'c1', 'text', storage), 'meu rascunho')
  assert.equal(readStatusDraft('u2', 'c1', 'text', storage), '')
  clearStatusDraft('u1', 'c1', 'text', storage)
  assert.equal(readStatusDraft('u1', 'c1', 'text', storage), '')
})

test('draft storage failures never break editing', () => {
  const blocked = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {
      throw new Error('blocked')
    },
    removeItem() {
      throw new Error('blocked')
    },
  }
  assert.doesNotThrow(() => saveStatusDraft('u1', 'c1', 'text', 'texto', blocked))
  assert.equal(readStatusDraft('u1', 'c1', 'text', blocked), '')
  assert.doesNotThrow(() => clearStatusDraft('u1', 'c1', 'text', blocked))
})

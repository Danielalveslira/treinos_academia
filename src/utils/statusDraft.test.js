import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATUS_TEXT_MAX_LENGTH } from './statusLimits.js'
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

test('o rascunho guarda e devolve até o limite de caracteres de markdown sem perder formatação', () => {
  const storage = memoryStorage()
  const markdown =
    '# Título\n\n- item **um**\n- item _dois_\n\n> citação\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n'
  const draft = markdown.padEnd(STATUS_TEXT_MAX_LENGTH, 'x')
  assert.equal(draft.length, STATUS_TEXT_MAX_LENGTH)
  saveStatusDraft('u1', 'c1', 'text', draft, storage)
  const restored = readStatusDraft('u1', 'c1', 'text', storage)
  assert.equal(restored.length, STATUS_TEXT_MAX_LENGTH)
  assert.equal(restored, draft, 'títulos, listas, citação, tabela e quebras de linha intactos')
})

test('rascunho acima do limite é cortado no limite (nunca grava mais que o formulário aceita)', () => {
  const storage = memoryStorage()
  saveStatusDraft('u1', 'c1', 'text', 'y'.repeat(STATUS_TEXT_MAX_LENGTH + 2000), storage)
  assert.equal(readStatusDraft('u1', 'c1', 'text', storage).length, STATUS_TEXT_MAX_LENGTH)
  // rascunhos antigos (até 500 ou 1000) continuam sendo restaurados inteiros
  saveStatusDraft('u1', 'c2', 'text', 'z'.repeat(Math.min(500, STATUS_TEXT_MAX_LENGTH)), storage)
  assert.equal(
    readStatusDraft('u1', 'c2', 'text', storage).length,
    Math.min(500, STATUS_TEXT_MAX_LENGTH)
  )
})

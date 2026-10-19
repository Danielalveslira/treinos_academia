import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsProfileCompletion } from './profileCompletion.js'

test('needsProfileCompletion: perfil CARREGANDO (ausente) nunca dispara o gate', () => {
  assert.equal(needsProfileCompletion(null), false)
  assert.equal(needsProfileCompletion(undefined), false)
})

test('needsProfileCompletion: perfil VAZIO (carregado, sem username) dispara o gate', () => {
  assert.equal(needsProfileCompletion({ id: 'u1', username: null }), true)
  assert.equal(needsProfileCompletion({ id: 'u1', username: '' }), true)
})

test('needsProfileCompletion: perfil COMPLETO (com username) nunca dispara o gate', () => {
  assert.equal(needsProfileCompletion({ id: 'u1', username: 'maria' }), false)
})

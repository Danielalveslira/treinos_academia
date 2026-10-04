import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSameSessionIdentity } from './authSession.js'

test('primeira carga (nada carregado) sempre carrega', () => {
  assert.equal(isSameSessionIdentity(undefined, null), false)
  assert.equal(isSameSessionIdentity(undefined, { id: 'a' }), false)
})

test('reemissão da mesma sessão (TOKEN_REFRESHED, SIGNED_IN ao focar a aba) não recarrega', () => {
  assert.equal(isSameSessionIdentity('a', { id: 'a', access_token: 'novo' }), true)
  assert.equal(isSameSessionIdentity(null, null), true)
})

test('login, logout e troca de usuário recarregam', () => {
  assert.equal(isSameSessionIdentity(null, { id: 'a' }), false)
  assert.equal(isSameSessionIdentity('a', null), false)
  assert.equal(isSameSessionIdentity('a', { id: 'b' }), false)
})

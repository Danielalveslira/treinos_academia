import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { isSameSessionIdentity, restrictedAuthScope } from './authSession.js'

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

test('sessão temporária é reconhecida apenas para orientar a UI', () => {
  const session = (role) => ({ access_token: `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.x` })
  assert.equal(restrictedAuthScope(session('auth_setup')), 'auth_setup')
  assert.equal(restrictedAuthScope(session('auth_signup')), 'auth_signup')
  assert.equal(restrictedAuthScope(session('auth_recovery')), 'auth_recovery')
  assert.equal(restrictedAuthScope(session('authenticated')), null)
  assert.equal(restrictedAuthScope({ access_token: 'invalid' }), null)
})

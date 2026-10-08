import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memberHandle } from './memberHandle.js'

test('mostra o @usuário quando existe', () => {
  assert.equal(memberHandle('ana'), '@ana')
  assert.equal(memberHandle('  ana  '), '@ana')
})

test('sem perfil público ou valor inesperado vira "Membro", nunca um id', () => {
  const uuid = 'e3772c28-d8cd-4232-bad0-4469db3070d0'
  for (const value of [null, undefined, '', '   ', 42, {}, []])
    assert.equal(memberHandle(value), 'Membro')
  assert.doesNotMatch(memberHandle(null), new RegExp(uuid))
})

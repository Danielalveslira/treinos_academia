import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeForSearch } from './text.js'

test('normalizeForSearch remove acentos/cedilha e ignora maiúsculas -- nunca usado pra apresentação', () => {
  assert.equal(normalizeForSearch('Abraçar a Bola'), 'abracar a bola')
  assert.equal(normalizeForSearch('Extensão de Pé'), 'extensao de pe')
  assert.equal(normalizeForSearch('ÁÉÍÓÚÇÃÕ'), 'aeioucao')
})

test('normalizeForSearch é estável pra valores ausentes/vazios', () => {
  assert.equal(normalizeForSearch(null), '')
  assert.equal(normalizeForSearch(undefined), '')
  assert.equal(normalizeForSearch(''), '')
})

test('normalizeForSearch permite achar nome acentuado buscando sem acento', () => {
  const name = 'Abraçar a Bola'
  assert.ok(normalizeForSearch(name).includes(normalizeForSearch('abracar')))
})

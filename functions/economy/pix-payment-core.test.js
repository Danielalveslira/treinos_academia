import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isValidPixMethodFields,
  isValidPixMethodLabel,
  generatePixMethodId,
  buildPublicPixPaymentProjection,
} from './pix-payment-core.js'

const VALID_FIELDS = { key: 'chave-pix@evolutus.app', keyType: 'email', recipientName: 'Evolutus Ltda' }

test('isValidPixMethodFields accepts a well-formed set of fields', () => {
  assert.equal(isValidPixMethodFields(VALID_FIELDS), true)
})

test('isValidPixMethodFields rejects a missing/empty/oversized key', () => {
  for (const bad of ['', '   ', 42, null, undefined, 'x'.repeat(201)]) {
    assert.equal(isValidPixMethodFields({ ...VALID_FIELDS, key: bad }), false)
  }
  assert.equal(isValidPixMethodFields({ ...VALID_FIELDS, key: 'x'.repeat(200) }), true)
})

test('isValidPixMethodFields rejects an unknown/missing keyType', () => {
  for (const bad of ['pix', '', null, undefined, 'EMAIL']) {
    assert.equal(isValidPixMethodFields({ ...VALID_FIELDS, keyType: bad }), false)
  }
  for (const good of ['email', 'phone', 'cpf', 'cnpj', 'random']) {
    assert.equal(isValidPixMethodFields({ ...VALID_FIELDS, keyType: good }), true)
  }
})

test('isValidPixMethodFields rejects a missing/empty/oversized recipientName', () => {
  for (const bad of ['', '   ', 42, null, undefined, 'x'.repeat(141)]) {
    assert.equal(isValidPixMethodFields({ ...VALID_FIELDS, recipientName: bad }), false)
  }
  assert.equal(isValidPixMethodFields({ ...VALID_FIELDS, recipientName: 'x'.repeat(140) }), true)
})

test('isValidPixMethodFields never crashes on a missing/malformed object', () => {
  assert.equal(isValidPixMethodFields(undefined), false)
  assert.equal(isValidPixMethodFields(null), false)
  assert.equal(isValidPixMethodFields({}), false)
})

test('isValidPixMethodLabel accepts a well-formed identifier name', () => {
  assert.equal(isValidPixMethodLabel('Conta principal'), true)
})

test('isValidPixMethodLabel rejects missing/empty/oversized labels', () => {
  for (const bad of ['', '   ', 42, null, undefined, 'x'.repeat(81)]) {
    assert.equal(isValidPixMethodLabel(bad), false)
  }
  assert.equal(isValidPixMethodLabel('x'.repeat(80)), true)
})

test('generatePixMethodId always starts with pix_ and is never reused across calls', () => {
  const ids = new Set(Array.from({ length: 20 }, () => generatePixMethodId()))
  assert.equal(ids.size, 20, 'todos os IDs gerados são únicos')
  for (const id of ids) assert.match(id, /^pix_[0-9a-f-]{36}$/)
})

test('buildPublicPixPaymentProjection carries only key/keyType/recipientName from the method, never label/createdAt/updatedAt', () => {
  const method = {
    label: 'Conta principal',
    key: 'chave@evolutus.app',
    keyType: 'email',
    recipientName: 'Evolutus Ltda',
    createdAt: 'algum-timestamp',
    updatedAt: 'outro-timestamp',
  }
  assert.deepEqual(buildPublicPixPaymentProjection(true, method), {
    enabled: true,
    key: 'chave@evolutus.app',
    keyType: 'email',
    recipientName: 'Evolutus Ltda',
  })
})

test('buildPublicPixPaymentProjection normalizes enabled to a strict boolean', () => {
  const method = { key: 'x', keyType: 'random', recipientName: 'Y' }
  assert.equal(buildPublicPixPaymentProjection(false, method).enabled, false)
  assert.equal(buildPublicPixPaymentProjection(undefined, method).enabled, false)
  assert.equal(buildPublicPixPaymentProjection(1, method).enabled, false)
  assert.equal(buildPublicPixPaymentProjection(true, method).enabled, true)
})

// Enquanto desativado, a projeção pública nunca carrega key/keyType/recipientName -- só
// {enabled:false}. Isto é o que garante (junto com tx.update() em vez de set com
// merge:true no service) que desativar não deixa a chave anterior vazando em
// economyConfig/current, mesmo que ela continue preservada em privatePaymentConfig/pix.
test('buildPublicPixPaymentProjection drops key/keyType/recipientName entirely while disabled -- only {enabled:false}', () => {
  const method = { key: 'chave@evolutus.app', keyType: 'email', recipientName: 'Evolutus Ltda' }
  assert.deepEqual(buildPublicPixPaymentProjection(false, method), { enabled: false })
  assert.deepEqual(buildPublicPixPaymentProjection(undefined, method), { enabled: false })
  assert.deepEqual(buildPublicPixPaymentProjection(null, method), { enabled: false })
})

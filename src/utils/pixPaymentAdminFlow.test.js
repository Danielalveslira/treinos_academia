import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PIX_KEY_TYPE_OPTIONS, isValidPixMethodForm, canDeletePixMethod } from './pixPaymentAdminFlow.js'

test('PIX_KEY_TYPE_OPTIONS covers exactly the 5 backend-accepted key types', () => {
  assert.deepEqual(
    PIX_KEY_TYPE_OPTIONS.map((option) => option.value).sort(),
    ['cnpj', 'cpf', 'email', 'phone', 'random']
  )
  for (const option of PIX_KEY_TYPE_OPTIONS) {
    assert.equal(typeof option.label, 'string')
    assert.ok(option.label.length > 0)
  }
})

const VALID_FORM = { label: 'Conta principal', key: 'chave@evolutus.app', keyType: 'email', recipientName: 'Evolutus Ltda' }

test('isValidPixMethodForm accepts a well-formed form', () => {
  assert.equal(isValidPixMethodForm(VALID_FORM), true)
})

test('isValidPixMethodForm rejects a missing/empty label', () => {
  for (const bad of ['', '   ', undefined, 'x'.repeat(81)]) {
    assert.equal(isValidPixMethodForm({ ...VALID_FORM, label: bad }), false)
  }
})

test('isValidPixMethodForm rejects a missing/empty key', () => {
  for (const bad of ['', '   ', undefined, 'x'.repeat(201)]) {
    assert.equal(isValidPixMethodForm({ ...VALID_FORM, key: bad }), false)
  }
})

test('isValidPixMethodForm rejects an unknown/missing keyType', () => {
  for (const bad of ['bitcoin', '', undefined, 'EMAIL']) {
    assert.equal(isValidPixMethodForm({ ...VALID_FORM, keyType: bad }), false)
  }
})

test('isValidPixMethodForm rejects a missing/empty recipientName', () => {
  for (const bad of ['', '   ', undefined, 'x'.repeat(141)]) {
    assert.equal(isValidPixMethodForm({ ...VALID_FORM, recipientName: bad }), false)
  }
})

test('canDeletePixMethod blocks only the currently active method', () => {
  assert.equal(canDeletePixMethod({ id: 'pix_a' }, 'pix_a'), false)
  assert.equal(canDeletePixMethod({ id: 'pix_b' }, 'pix_a'), true)
  assert.equal(canDeletePixMethod({ id: 'pix_a' }, null), true)
})

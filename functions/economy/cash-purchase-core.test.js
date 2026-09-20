import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cashPurchaseIdFromRequest,
  isValidCashPackage,
  isValidPixPayment,
  isValidPurchaseSnapshot,
  financialBlockReason,
  resolveConfigVersion,
} from './cash-purchase-core.js'

test('cashPurchaseIdFromRequest is deterministic for the same uid+requestId', () => {
  assert.equal(cashPurchaseIdFromRequest('u1', 'r1'), cashPurchaseIdFromRequest('u1', 'r1'))
})

test('cashPurchaseIdFromRequest differs for a different uid or a different requestId', () => {
  const base = cashPurchaseIdFromRequest('u1', 'r1')
  assert.notEqual(base, cashPurchaseIdFromRequest('u2', 'r1'))
  assert.notEqual(base, cashPurchaseIdFromRequest('u1', 'r2'))
})

const VALID_PACKAGE = { cashAmount: 100, amountCentavos: 990, label: '100 EvoCash', active: true }

test('isValidCashPackage accepts a well-formed package', () => {
  assert.equal(isValidCashPackage(VALID_PACKAGE), true)
})

test('isValidCashPackage rejects a missing/null/non-object value (config ausente/corrompida)', () => {
  assert.equal(isValidCashPackage(undefined), false)
  assert.equal(isValidCashPackage(null), false)
  assert.equal(isValidCashPackage('100'), false)
  assert.equal(isValidCashPackage(42), false)
})

for (const field of ['cashAmount', 'amountCentavos']) {
  test(`isValidCashPackage rejects malformed ${field}`, () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, '100', null, undefined, Number.MAX_SAFE_INTEGER + 10]) {
      assert.equal(
        isValidCashPackage({ ...VALID_PACKAGE, [field]: bad }),
        false,
        `${field}=${bad} deveria reprovar`
      )
    }
  })

  test(`isValidCashPackage rejects ${field} acima do teto de sanidade`, () => {
    const max = field === 'cashAmount' ? 1_000_000 : 10_000_000
    assert.equal(isValidCashPackage({ ...VALID_PACKAGE, [field]: max + 1 }), false)
    assert.equal(isValidCashPackage({ ...VALID_PACKAGE, [field]: max }), true)
  })
}

test('isValidCashPackage rejects malformed label', () => {
  for (const bad of ['', '   ', 'x'.repeat(81), 42, null, undefined]) {
    assert.equal(isValidCashPackage({ ...VALID_PACKAGE, label: bad }), false)
  }
})

test('isValidCashPackage não exige/valida "active" -- é um gate de disponibilidade separado, checado por quem chama', () => {
  assert.equal(isValidCashPackage({ cashAmount: 100, amountCentavos: 990, label: 'x' }), true)
})

const VALID_SNAPSHOT = {
  userId: 'buyer1',
  packageId: 'pack_100',
  packageLabel: '100 EvoCash',
  cashAmount: 100,
  amountCentavos: 990,
  currency: 'BRL',
}

test('isValidPurchaseSnapshot accepts a well-formed snapshot (revalidação defensiva antes de creditar)', () => {
  assert.equal(isValidPurchaseSnapshot(VALID_SNAPSHOT), true)
})

test('isValidPurchaseSnapshot rejects missing/malformed userId', () => {
  for (const bad of ['', null, undefined, 42]) {
    assert.equal(isValidPurchaseSnapshot({ ...VALID_SNAPSHOT, userId: bad }), false)
  }
})

test('isValidPurchaseSnapshot rejects a currency other than BRL', () => {
  for (const bad of ['USD', '', null, undefined, 'brl']) {
    assert.equal(isValidPurchaseSnapshot({ ...VALID_SNAPSHOT, currency: bad }), false)
  }
})

test('isValidPurchaseSnapshot rejects the same malformed cashAmount/amountCentavos/label isValidCashPackage would', () => {
  assert.equal(isValidPurchaseSnapshot({ ...VALID_SNAPSHOT, cashAmount: -1 }), false)
  assert.equal(isValidPurchaseSnapshot({ ...VALID_SNAPSHOT, amountCentavos: 1.5 }), false)
  assert.equal(isValidPurchaseSnapshot({ ...VALID_SNAPSHOT, packageLabel: '' }), false)
})

const VALID_PIX_PAYMENT = {
  enabled: true,
  key: 'chave-pix-teste@evolutus.app',
  keyType: 'email',
  recipientName: 'Evolutus Ltda',
}

test('isValidPixPayment accepts a well-formed, enabled config', () => {
  assert.equal(isValidPixPayment(VALID_PIX_PAYMENT), true)
})

test('isValidPixPayment rejects a missing/null/non-object value (config ausente/corrompida)', () => {
  assert.equal(isValidPixPayment(undefined), false)
  assert.equal(isValidPixPayment(null), false)
  assert.equal(isValidPixPayment('pix'), false)
  assert.equal(isValidPixPayment(42), false)
})

test('isValidPixPayment rejects enabled !== true (ausente, false, ou qualquer valor truthy que não seja o booleano true)', () => {
  for (const bad of [false, undefined, 1, 'true', null]) {
    assert.equal(isValidPixPayment({ ...VALID_PIX_PAYMENT, enabled: bad }), false)
  }
})

test('isValidPixPayment rejects a missing/empty/oversized key', () => {
  for (const bad of ['', '   ', 42, null, undefined, 'x'.repeat(201)]) {
    assert.equal(isValidPixPayment({ ...VALID_PIX_PAYMENT, key: bad }), false)
  }
  assert.equal(isValidPixPayment({ ...VALID_PIX_PAYMENT, key: 'x'.repeat(200) }), true)
})

test('isValidPixPayment rejects an unknown/missing keyType', () => {
  for (const bad of ['pix', '', null, undefined, 'EMAIL']) {
    assert.equal(isValidPixPayment({ ...VALID_PIX_PAYMENT, keyType: bad }), false)
  }
  for (const good of ['email', 'phone', 'cpf', 'cnpj', 'random']) {
    assert.equal(isValidPixPayment({ ...VALID_PIX_PAYMENT, keyType: good }), true)
  }
})

test('isValidPixPayment rejects a missing/empty/oversized recipientName', () => {
  for (const bad of ['', '   ', 42, null, undefined, 'x'.repeat(141)]) {
    assert.equal(isValidPixPayment({ ...VALID_PIX_PAYMENT, recipientName: bad }), false)
  }
  assert.equal(isValidPixPayment({ ...VALID_PIX_PAYMENT, recipientName: 'x'.repeat(140) }), true)
})

test('financialBlockReason: compra pending bloqueia independente do saldo', () => {
  assert.equal(financialBlockReason({ pendingPurchaseId: 'p1', cashBalance: 0 }), 'pending_cash_purchase')
  assert.equal(
    financialBlockReason({ pendingPurchaseId: 'p1', cashBalance: 500 }),
    'pending_cash_purchase',
    'pending tem prioridade sobre saldo positivo -- só um motivo é reportado'
  )
})

test('financialBlockReason: saldo positivo bloqueia quando não há pending', () => {
  assert.equal(financialBlockReason({ pendingPurchaseId: null, cashBalance: 1 }), 'positive_cash_balance')
})

test('resolveConfigVersion keeps a valid positive integer as-is', () => {
  assert.equal(resolveConfigVersion(7), 7)
  assert.equal(resolveConfigVersion(1), 1)
  assert.equal(resolveConfigVersion(1_000_000), 1_000_000)
})

test('resolveConfigVersion falls back to null when version is missing (economyConfig/current sem esse campo)', () => {
  assert.equal(resolveConfigVersion(undefined), null)
  assert.equal(resolveConfigVersion(null), null)
})

test('resolveConfigVersion falls back to null for any invalid version, never crashes the write', () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, '7', {}, [], true, 1_000_001]) {
    assert.equal(resolveConfigVersion(bad), null, `version=${JSON.stringify(bad)} deveria virar null`)
  }
})

test('financialBlockReason: nada bloqueia quando não há pending nem saldo', () => {
  assert.equal(financialBlockReason({ pendingPurchaseId: null, cashBalance: 0 }), null)
  assert.equal(financialBlockReason({ pendingPurchaseId: undefined, cashBalance: undefined }), null)
  assert.equal(financialBlockReason({ pendingPurchaseId: '', cashBalance: -5 }), null)
})

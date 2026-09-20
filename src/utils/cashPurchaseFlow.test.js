import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveRequestId,
  hasPendingCashPurchase,
  canSubmitCancellation,
  USER_CASH_PURCHASE_STATUS_LABELS,
  ADMIN_CASH_PURCHASE_STATUS_LABELS,
  resolvePixKeyTypeLabel,
  abbreviateProtocol,
  normalizeCashPurchasesAdminTab,
} from './cashPurchaseFlow.js'

test('resolveRequestId reuses the same requestId when retrying the same package', () => {
  const pendingAttempt = { key: 'pack_100', requestId: 'req-1' }
  const generated = () => {
    throw new Error('should not generate a new id on retry')
  }
  assert.equal(resolveRequestId(pendingAttempt, 'pack_100', generated), 'req-1')
})

test('resolveRequestId generates a new requestId when there is no attempt in flight', () => {
  assert.equal(resolveRequestId(null, 'pack_100', () => 'fresh-id'), 'fresh-id')
})

test('resolveRequestId generates a new requestId when the package changed (a different purchase intent)', () => {
  const pendingAttempt = { key: 'pack_100', requestId: 'req-1' }
  assert.equal(resolveRequestId(pendingAttempt, 'pack_550', () => 'fresh-id'), 'fresh-id')
})

// Fase 5: CreateCommunity.jsx reaproveita esta MESMA função (chave = JSON.stringify dos
// valores do formulário, em vez de um packageId) -- prova que retry de uma submissão
// que falhou reaproveita o requestId, e que editar o formulário depois de uma falha
// (uma intenção diferente) gera um requestId novo, exatamente como no fluxo de EvoCash.
test('resolveRequestId also protects retries of a form-shaped key (community creation reuses it)', () => {
  const values = { name: 'Corrida', description: '', iconName: 'flame' }
  const attemptKey = JSON.stringify(values)
  const pendingAttempt = { key: attemptKey, requestId: 'community-req-1' }
  assert.equal(resolveRequestId(pendingAttempt, attemptKey, () => 'new-id'), 'community-req-1')

  const editedKey = JSON.stringify({ ...values, name: 'Nome editado' })
  assert.equal(resolveRequestId(pendingAttempt, editedKey, () => 'new-id'), 'new-id')
})

test('hasPendingCashPurchase is true only when some purchase is still pending', () => {
  assert.equal(hasPendingCashPurchase([{ status: 'credited' }, { status: 'pending' }]), true)
  assert.equal(hasPendingCashPurchase([{ status: 'credited' }, { status: 'cancelled' }]), false)
  assert.equal(hasPendingCashPurchase([]), false)
})

test('canSubmitCancellation mirrors the server minimum (5 trimmed characters)', () => {
  assert.equal(canSubmitCancellation('oi'), false)
  assert.equal(canSubmitCancellation('    '), false)
  assert.equal(canSubmitCancellation('   oi '), false)
  assert.equal(canSubmitCancellation('12345'), true)
  assert.equal(canSubmitCancellation('  12345  '), true)
  assert.equal(canSubmitCancellation(undefined), false)
})

test('the user-facing and admin-facing status maps both cover exactly pending/credited/cancelled', () => {
  for (const labels of [USER_CASH_PURCHASE_STATUS_LABELS, ADMIN_CASH_PURCHASE_STATUS_LABELS]) {
    assert.deepEqual(Object.keys(labels).sort(), ['cancelled', 'credited', 'pending'])
    for (const status of ['pending', 'credited', 'cancelled']) {
      assert.equal(typeof labels[status].text, 'string')
      assert.ok(labels[status].text.length > 0)
      assert.equal(typeof labels[status].variant, 'string')
    }
  }
})

test('resolvePixKeyTypeLabel maps every valid keyType to a Portuguese label', () => {
  assert.equal(resolvePixKeyTypeLabel('email'), 'E-mail')
  assert.equal(resolvePixKeyTypeLabel('phone'), 'Telefone')
  assert.equal(resolvePixKeyTypeLabel('cpf'), 'CPF')
  assert.equal(resolvePixKeyTypeLabel('cnpj'), 'CNPJ')
  assert.equal(resolvePixKeyTypeLabel('random'), 'Chave aleatória')
})

test('resolvePixKeyTypeLabel falls back to a generic label for an unknown/missing keyType, never crashes', () => {
  assert.equal(resolvePixKeyTypeLabel('unknown'), 'Chave PIX')
  assert.equal(resolvePixKeyTypeLabel(undefined), 'Chave PIX')
  assert.equal(resolvePixKeyTypeLabel(null), 'Chave PIX')
})

test('abbreviateProtocol shortens a real 64-char sha256 protocol to prefix…suffix', () => {
  const protocol = '1c900a837a5d1fbd2777e47b0a9fe9c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8924640f'
  const short = abbreviateProtocol(protocol)
  assert.equal(short, `${protocol.slice(0, 8)}…${protocol.slice(-7)}`)
  assert.ok(short.length < protocol.length, 'a versão abreviada é sempre mais curta que o valor real')
})

test('abbreviateProtocol never truncates a value already short enough to fit', () => {
  for (const value of ['abc', '', 'x'.repeat(15)]) {
    assert.equal(abbreviateProtocol(value), value)
  }
})

test('abbreviateProtocol leaves non-string input untouched, never crashes', () => {
  assert.equal(abbreviateProtocol(undefined), undefined)
  assert.equal(abbreviateProtocol(null), null)
})

test('normalizeCashPurchasesAdminTab accepts the 2 known tabs', () => {
  assert.equal(normalizeCashPurchasesAdminTab('pedidos'), 'pedidos')
  assert.equal(normalizeCashPurchasesAdminTab('pix'), 'pix')
})

test('normalizeCashPurchasesAdminTab falls back to "pedidos" for anything unknown, missing or malformed -- never breaks the page', () => {
  for (const bad of [undefined, null, '', 'outra-coisa', 'PIX', 42]) {
    assert.equal(normalizeCashPurchasesAdminTab(bad), 'pedidos')
  }
})

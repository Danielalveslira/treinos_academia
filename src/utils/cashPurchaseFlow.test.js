import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveRequestId,
  hasPendingCashPurchase,
  cashPurchaseStatusLabel,
  openInfinitepayCheckout,
  USER_CASH_PURCHASE_STATUS_LABELS,
  ADMIN_CASH_PURCHASE_STATUS_LABELS,
  abbreviateProtocol,
} from './cashPurchaseFlow.js'

test('resolveRequestId reuses the same requestId when retrying the same package', () => {
  const pendingAttempt = { key: 'pack_100', requestId: 'req-1' }
  const generated = () => {
    throw new Error('should not generate a new id on retry')
  }
  assert.equal(resolveRequestId(pendingAttempt, 'pack_100', generated), 'req-1')
})

test('resolveRequestId generates a new requestId when there is no attempt in flight', () => {
  assert.equal(
    resolveRequestId(null, 'pack_100', () => 'fresh-id'),
    'fresh-id'
  )
})

test('resolveRequestId generates a new requestId when the package changed (a different purchase intent)', () => {
  const pendingAttempt = { key: 'pack_100', requestId: 'req-1' }
  assert.equal(
    resolveRequestId(pendingAttempt, 'pack_550', () => 'fresh-id'),
    'fresh-id'
  )
})

// Fase 5: CreateCommunity.jsx reaproveita esta MESMA função (chave = JSON.stringify dos
// valores do formulário, em vez de um packageId) -- prova que retry de uma submissão
// que falhou reaproveita o requestId, e que editar o formulário depois de uma falha
// (uma intenção diferente) gera um requestId novo, exatamente como no fluxo de EvoCash.
test('resolveRequestId also protects retries of a form-shaped key (community creation reuses it)', () => {
  const values = { name: 'Corrida', description: '', iconName: 'flame' }
  const attemptKey = JSON.stringify(values)
  const pendingAttempt = { key: attemptKey, requestId: 'community-req-1' }
  assert.equal(
    resolveRequestId(pendingAttempt, attemptKey, () => 'new-id'),
    'community-req-1'
  )

  const editedKey = JSON.stringify({ ...values, name: 'Nome editado' })
  assert.equal(
    resolveRequestId(pendingAttempt, editedKey, () => 'new-id'),
    'new-id'
  )
})

test('hasPendingCashPurchase is true only when some purchase is still pending', () => {
  assert.equal(hasPendingCashPurchase([{ status: 'credited' }, { status: 'pending' }]), true)
  assert.equal(
    hasPendingCashPurchase([
      { status: 'pending', paymentProvider: 'infinitepay', checkoutUrl: null },
    ]),
    false
  )
  assert.equal(
    hasPendingCashPurchase([
      {
        status: 'pending',
        paymentProvider: 'infinitepay',
        checkoutUrl: 'https://checkout.infinitepay.io/x',
      },
    ]),
    true
  )
  assert.equal(
    hasPendingCashPurchase([{ status: 'checkout_failed', paymentProvider: 'infinitepay' }]),
    false
  )
  assert.equal(
    hasPendingCashPurchase([
      {
        status: 'cancelled',
        paymentProvider: 'infinitepay',
        checkoutUrl: 'https://checkout.infinitepay.io/x',
      },
    ]),
    false
  )
  assert.equal(hasPendingCashPurchase([{ status: 'credited' }, { status: 'cancelled' }]), false)
  assert.equal(hasPendingCashPurchase([]), false)
})

test('the user-facing and admin-facing status maps cover every purchase state', () => {
  for (const labels of [USER_CASH_PURCHASE_STATUS_LABELS, ADMIN_CASH_PURCHASE_STATUS_LABELS]) {
    assert.deepEqual(Object.keys(labels).sort(), [
      'cancelled',
      'checkout_failed',
      'credited',
      'held_in_case',
      'needs_review',
      'pending',
    ])
    for (const status of [
      'pending',
      'credited',
      'cancelled',
      'held_in_case',
      'checkout_failed',
      'needs_review',
    ]) {
      assert.equal(typeof labels[status].text, 'string')
      assert.ok(labels[status].text.length > 0)
      assert.equal(typeof labels[status].variant, 'string')
    }
  }
})

test('InfinitePay without a checkout URL is never labelled as awaiting payment', () => {
  const purchase = { paymentProvider: 'infinitepay', status: 'pending', checkoutUrl: null }
  assert.equal(
    cashPurchaseStatusLabel(purchase, USER_CASH_PURCHASE_STATUS_LABELS).text,
    'Preparando checkout'
  )
  assert.equal(
    cashPurchaseStatusLabel(
      { ...purchase, checkoutUncertain: true },
      USER_CASH_PURCHASE_STATUS_LABELS
    ).text,
    'Checkout em conciliação'
  )
  assert.equal(
    cashPurchaseStatusLabel({ ...purchase, status: 'cancelled' }, USER_CASH_PURCHASE_STATUS_LABELS)
      .text,
    'Cancelado'
  )
})

test('checkout success navigates to the InfinitePay page and refuses other hosts', () => {
  const opened = []
  openInfinitepayCheckout('https://checkout.infinitepay.io/evolutus?lenc=token', (url) =>
    opened.push(url)
  )
  assert.deepEqual(opened, ['https://checkout.infinitepay.io/evolutus?lenc=token'])
  assert.throws(
    () =>
      openInfinitepayCheckout('https://checkout.infinitepay.io.evil.test/x', (url) =>
        opened.push(url)
      ),
    /INVALID_CHECKOUT_URL/
  )
  assert.equal(opened.length, 1)
})

test('abbreviateProtocol shortens a real 64-char sha256 protocol to prefix…suffix', () => {
  const protocol = '1c900a837a5d1fbd2777e47b0a9fe9c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8924640f'
  const short = abbreviateProtocol(protocol)
  assert.equal(short, `${protocol.slice(0, 8)}…${protocol.slice(-7)}`)
  assert.ok(
    short.length < protocol.length,
    'a versão abreviada é sempre mais curta que o valor real'
  )
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

test('confirmed reversals and external refunds have distinct display labels', () => {
  assert.equal(
    cashPurchaseStatusLabel(
      { status: 'credited', reversedCentavos: 590, amountCentavos: 590 },
      USER_CASH_PURCHASE_STATUS_LABELS
    ).text,
    'Reembolsado / estornado'
  )
  assert.equal(
    cashPurchaseStatusLabel(
      { status: 'credited', reversedCentavos: 100, amountCentavos: 590 },
      USER_CASH_PURCHASE_STATUS_LABELS
    ).text,
    'Estorno parcial'
  )
  assert.equal(
    cashPurchaseStatusLabel(
      { status: 'cancelled', reviewResolution: 'refunded_externally' },
      USER_CASH_PURCHASE_STATUS_LABELS
    ).text,
    'Reembolsado externamente'
  )
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeNextPaymentDate,
  addBusinessDays,
  getSubscriptionState,
  validateConfirmPayment,
  validateSetAccountStatus,
  validateDeleteAccount,
} from './billing-core.js'

test('computeNextPaymentDate preserves the billing anchor day month over month', () => {
  const from = Date.UTC(2026, 8, 10, 12, 0, 0) // 10/09/2026
  const next = computeNextPaymentDate(from, 10)
  const date = new Date(next)
  assert.equal(date.getUTCFullYear(), 2026)
  assert.equal(date.getUTCMonth(), 9) // outubro
  assert.equal(date.getUTCDate(), 10)
})

test('computeNextPaymentDate clamps to the last valid day when the anchor day does not exist', () => {
  const from = Date.UTC(2026, 0, 31) // 31/01/2026, ancorado no dia 31
  const next = computeNextPaymentDate(from, 31)
  const date = new Date(next)
  assert.equal(date.getUTCMonth(), 1) // fevereiro
  assert.equal(date.getUTCDate(), 28) // 2026 não é bissexto
})

test('computeNextPaymentDate rolls over into the next year in december', () => {
  const from = Date.UTC(2026, 11, 10)
  const next = computeNextPaymentDate(from, 10)
  const date = new Date(next)
  assert.equal(date.getUTCFullYear(), 2027)
  assert.equal(date.getUTCMonth(), 0)
})

test('addBusinessDays skips weekends', () => {
  const friday = Date.UTC(2026, 9, 9) // sexta-feira, 09/10/2026
  const result = addBusinessDays(friday, 1)
  const date = new Date(result)
  assert.equal(date.getUTCDay(), 1) // segunda-feira
  assert.equal(date.getUTCDate(), 12)
})

test('getSubscriptionState returns NONE without a subscription', () => {
  assert.equal(getSubscriptionState(null), 'NONE')
  assert.equal(getSubscriptionState({}), 'NONE')
})

test('getSubscriptionState during trial: active before trialEndsAt, blocked after (no tolerance)', () => {
  const trialEndsAt = { toMillis: () => Date.UTC(2026, 8, 12) }
  const subscription = { trialEndsAt, paidAt: null }
  assert.equal(getSubscriptionState(subscription, Date.UTC(2026, 8, 11)), 'TRIAL_ACTIVE')
  assert.equal(getSubscriptionState(subscription, Date.UTC(2026, 8, 13)), 'BLOCKED')
})

test('getSubscriptionState after payment: active, due, grace, then blocked', () => {
  const subscription = {
    trialEndsAt: { toMillis: () => Date.UTC(2026, 8, 1) },
    paidAt: { toMillis: () => Date.UTC(2026, 8, 1) },
    nextPaymentAt: { toMillis: () => Date.UTC(2026, 9, 10) },
    graceEndsAt: { toMillis: () => Date.UTC(2026, 9, 13) },
  }
  assert.equal(getSubscriptionState(subscription, Date.UTC(2026, 9, 9)), 'ACTIVE')
  assert.equal(getSubscriptionState(subscription, Date.UTC(2026, 9, 10, 12)), 'PAYMENT_DUE')
  assert.equal(getSubscriptionState(subscription, Date.UTC(2026, 9, 11, 12)), 'GRACE_PERIOD')
  assert.equal(getSubscriptionState(subscription, Date.UTC(2026, 9, 14)), 'BLOCKED')
})

test('validateConfirmPayment requires a valid userId and planId', () => {
  assert.match(validateConfirmPayment({}), /Usuário inválido/)
  assert.match(validateConfirmPayment({ userId: 'u1' }), /plano/)
  assert.equal(validateConfirmPayment({ userId: 'u1', planId: 'basico', operationId: 'op1' }), null)
})

test('validateSetAccountStatus requires a reason only when disabling', () => {
  assert.equal(validateSetAccountStatus({ userId: 'u1', disabled: false }), null)
  assert.match(validateSetAccountStatus({ userId: 'u1', disabled: true }), /motivo/)
  assert.match(validateSetAccountStatus({ userId: 'u1', disabled: true, reason: 'oi' }), /motivo/)
  assert.equal(
    validateSetAccountStatus({ userId: 'u1', disabled: true, reason: 'Pagamento fraudulento' }),
    null
  )
})

test('validateDeleteAccount requires the literal confirmation phrase', () => {
  assert.match(validateDeleteAccount({ userId: 'u1', confirmation: 'excluir' }), /EXCLUIR/)
  assert.equal(validateDeleteAccount({ userId: 'u1', confirmation: 'EXCLUIR' }), null)
})

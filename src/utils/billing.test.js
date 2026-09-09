import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSubscriptionState, getUserAccessState, canAccessApp } from './billing.js'

test('getSubscriptionState mirrors the trial/blocked timeline', () => {
  const subscription = { trialEndsAt: new Date(2026, 8, 12), paidAt: null }
  assert.equal(getSubscriptionState(subscription, +new Date(2026, 8, 11)), 'TRIAL_ACTIVE')
  assert.equal(getSubscriptionState(subscription, +new Date(2026, 8, 13)), 'BLOCKED')
})

test('getSubscriptionState mirrors the paid active/due/grace/blocked timeline', () => {
  const subscription = {
    trialEndsAt: new Date(2026, 8, 1),
    paidAt: new Date(2026, 8, 1),
    nextPaymentAt: new Date(2026, 9, 10),
    graceEndsAt: new Date(2026, 9, 13),
  }
  assert.equal(getSubscriptionState(subscription, +new Date(2026, 9, 9)), 'ACTIVE')
  assert.equal(getSubscriptionState(subscription, +new Date(2026, 9, 10, 12)), 'PAYMENT_DUE')
  assert.equal(getSubscriptionState(subscription, +new Date(2026, 9, 11, 12)), 'GRACE_PERIOD')
  assert.equal(getSubscriptionState(subscription, +new Date(2026, 9, 14)), 'BLOCKED')
})

test('getUserAccessState blocks a disabled account regardless of subscription', () => {
  const profile = {
    role: 'user',
    accountStatus: 'disabled',
    disabledReason: 'Pagamento fraudulento',
    subscription: { trialEndsAt: new Date(2099, 0, 1), paidAt: null },
  }
  const state = getUserAccessState(profile)
  assert.equal(state.canAccess, false)
  assert.equal(state.reason, 'disabled')
  assert.equal(state.disabledReason, 'Pagamento fraudulento')
})

test('getUserAccessState never blocks a superadmin', () => {
  const profile = { role: 'superadmin', accountStatus: 'disabled', subscription: null }
  assert.equal(canAccessApp(profile), true)
})

test('canAccessApp allows trial/active/due/grace and blocks BLOCKED/NONE', () => {
  const base = { role: 'user', accountStatus: 'active' }
  assert.equal(
    canAccessApp({ ...base, subscription: { trialEndsAt: new Date(2099, 0, 1), paidAt: null } }),
    true
  )
  assert.equal(canAccessApp({ ...base, subscription: null }), false)
  assert.equal(
    canAccessApp({
      ...base,
      subscription: { trialEndsAt: new Date(2000, 0, 1), paidAt: null },
    }),
    false
  )
})

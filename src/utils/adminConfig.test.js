import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConfigCache } from './configCache.js'
import { validateBillingConfig } from './billingConfig.js'
import { DEFAULT_BILLING_CONFIG } from './billing.js'

test('configuration cache shares in-flight reads, isolates auth identities and retries errors', async () => {
  let calls = 0
  let fail = true
  const cache = createConfigCache(async (uid) => {
    calls++
    if (uid === 'failed' && fail) throw new Error('network')
    return uid
  })
  assert.deepEqual(await Promise.all([cache.get(''), cache.get('')]), ['', ''])
  assert.equal(calls, 1)
  assert.equal(await cache.get('signed-in'), 'signed-in')
  assert.equal(calls, 2)
  await assert.rejects(cache.get('failed'))
  fail = false
  assert.equal(await cache.get('failed'), 'failed')
  assert.equal(calls, 4)
  cache.clear()
  await cache.get('signed-in')
  assert.equal(calls, 5)
})

test('invalidated pending requests cannot poison new configuration', async () => {
  let reject
  let calls = 0
  const cache = createConfigCache(() =>
    ++calls === 1
      ? new Promise((_, no) => {
          reject = no
        })
      : 'new'
  )
  const old = cache.get('user')
  await Promise.resolve()
  cache.clear()
  assert.equal(await cache.get('user'), 'new')
  reject(new Error('old'))
  await assert.rejects(old)
  assert.equal(await cache.get('user'), 'new')
  assert.equal(calls, 2)
})

test('billing configuration rejects nonfinite/negative prices, invalid days and duplicate plan IDs', () => {
  assert.equal(validateBillingConfig(DEFAULT_BILLING_CONFIG), null)
  for (const value of [-1, Infinity, NaN, '50', 100001]) {
    assert.ok(
      validateBillingConfig({
        ...DEFAULT_BILLING_CONFIG,
        plans: [{ ...DEFAULT_BILLING_CONFIG.plans[0], price: value }],
      })
    )
  }
  for (const value of [-1, 1.5, Infinity, 31])
    assert.ok(validateBillingConfig({ ...DEFAULT_BILLING_CONFIG, graceBusinessDays: value }))
  assert.ok(
    validateBillingConfig({
      ...DEFAULT_BILLING_CONFIG,
      plans: Array(2).fill(DEFAULT_BILLING_CONFIG.plans[0]),
    })
  )
})

test('configuration cache expires without a permanent database listener', async () => {
  let now = 0
  let calls = 0
  const cache = createConfigCache(async () => ++calls, { now: () => now, maxAge: 100 })
  assert.equal(await cache.get('user'), 1)
  now = 101
  assert.equal(await cache.get('user'), 2)
})

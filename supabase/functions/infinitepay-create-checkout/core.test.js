import test from 'node:test'
import assert from 'node:assert/strict'
import { checkoutPayload, createCheckout, validCheckoutUrl } from './core.js'

const reservation = { id: '123', orderNsu: `evo_${'a'.repeat(32)}`, packageLabel: 'Essencial', amountCentavos: 590, cashAmount: 25, createLink: true }
function fixtures(overrides = {}) {
  const calls = []
  const userClient = { rpc: async () => ({ data: true, error: null }) }
  const admin = { rpc: async (name, params) => {
    calls.push([name, params])
    return name === 'reserve_infinitepay_cash_purchase' ? { data: reservation, error: null } : { data: null, error: null }
  } }
  const fetcher = async (_url, options) => {
    calls.push(['fetch', JSON.parse(options.body)])
    return { ok: true, status: 200, json: async () => ({ url: 'https://checkout.infinitepay.io/tag?lenc=token' }) }
  }
  return { calls, userClient, admin, fetcher, userId: 'user-1', packageId: 'pack_25',
    handle: 'my-tag', appUrl: 'https://app.example', supabaseUrl: 'https://project.supabase.co',
    logger: { warn: (...parts) => calls.push(['log', ...parts]), error: (...parts) => calls.push(['log', ...parts]) }, ...overrides }
}

test('checkout sends only the server price and order, then persists the validated URL', async () => {
  const deps = fixtures()
  const result = await createCheckout(deps)
  assert.equal(result.checkoutUrl, 'https://checkout.infinitepay.io/tag?lenc=token')
  assert.equal(deps.calls[0][0], 'reserve_infinitepay_cash_purchase')
  assert.deepEqual(Object.keys(deps.calls[0][1]).sort(), ['p_package_id', 'p_user_id'])
  assert.equal(deps.calls[1][1].items[0].price, 590)
  assert.deepEqual(Object.keys(deps.calls[1][1]).sort(),
    ['handle', 'items', 'order_nsu', 'redirect_url', 'webhook_url'])
  assert.equal('address' in deps.calls[1][1], false)
  assert.equal('customer' in deps.calls[1][1], false)
  assert.equal(deps.calls[1][1].order_nsu, reservation.orderNsu)
  assert.match(deps.calls[1][1].redirect_url, /purchase_id=123/)
  assert.equal(deps.calls[2][0], 'finish_infinitepay_checkout')
})

test('inactive/invalid package and app access do not create links', async () => {
  const invalid = fixtures({ packageId: 'bad value' })
  await assert.rejects(createCheckout(invalid), /INVALID_REQUEST/)
  assert.equal(invalid.calls.length, 0)
  const denied = fixtures({ userClient: { rpc: async () => ({ data: false }) } })
  await assert.rejects(createCheckout(denied), /APP_ACCESS_DENIED/)
  assert.equal(denied.calls.length, 0)
  const badOrigin = fixtures({ appUrl: 'http://app.example' })
  await assert.rejects(createCheckout(badOrigin), /INFINITEPAY_NOT_CONFIGURED/)
  assert.equal(badOrigin.calls.length, 0)
})

test('retry reuses an existing checkout and never calls links again', async () => {
  const deps = fixtures({ admin: { rpc: async () => ({ data: { id: '123', checkoutUrl: 'https://checkout.infinitepay.com.br/a', status: 'pending' } }) },
    fetcher: () => { throw new Error('duplicate link') } })
  assert.equal((await createCheckout(deps)).id, '123')
})

test('4xx marks checkout_failed and allows a safe retry of the same purchase', async () => {
  const deps = fixtures({ fetcher: async () => ({ ok: false, status: 422,
    json: async () => ({ code: 'INVALID_HANDLE', message: 'Rejected' }) }) })
  await assert.rejects(createCheckout(deps), /INFINITEPAY_LINK_FAILED/)
  assert.equal(deps.calls.at(-1)[0], 'fail_infinitepay_checkout')
  assert.equal(deps.calls.at(-1)[1].p_http_status, 422)
  assert.deepEqual(deps.calls.find((call) => call[0] === 'log')[2],
    { status: 422, providerCode: 'INVALID_HANDLE', responseKeys: ['code', 'message'] })
})

test('5xx, missing URL and timeout require reconciliation, without a second link', async () => {
  const failures = [
    async () => ({ ok: false, status: 503, json: async () => ({ message: 'Unavailable' }) }),
    async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
    async () => { throw new DOMException('Timed out', 'TimeoutError') },
  ]
  for (const fetcher of failures) {
    const deps = fixtures({ fetcher })
    await assert.rejects(createCheckout(deps))
    assert.equal(deps.calls.at(-1)[0], 'mark_infinitepay_checkout_uncertain')
  }
})

test('an uncertain purchase does not call links again', async () => {
  const deps = fixtures({ admin: { rpc: async () => ({ data: { id: '123', createLink: false, uncertain: true } }) },
    fetcher: () => { throw new Error('duplicate link') } })
  await assert.rejects(createCheckout(deps), /CHECKOUT_RECONCILIATION_REQUIRED/)
})

test('external URLs are restricted to the actual InfinitePay checkout hosts', () => {
  assert.equal(validCheckoutUrl('https://checkout.infinitepay.io/tag?lenc=x'), true)
  assert.equal(validCheckoutUrl('https://checkout.infinitepay.com.br/tag?lenc=x'), true)
  for (const url of ['http://checkout.infinitepay.io/', 'https://evil.test/',
    'https://checkout.infinitepay.io.evil.test/',
    'https://checkout.infinitepay.com.br.evil.test/', 'https://user@checkout.infinitepay.com.br/'])
    assert.equal(validCheckoutUrl(url), false)
  assert.throws(() => checkoutPayload({ handle: 'x', orderNsu: reservation.orderNsu, amountCentavos: 590 }), /INVALID_CHECKOUT_INPUT/)
})

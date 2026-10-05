import test from 'node:test'
import assert from 'node:assert/strict'
import { paymentHint, verifyAndConfirm } from '../_shared/infinitepay.js'

const hint = { orderNsu: `evo_${'a'.repeat(32)}`, transactionNsu: 'transaction-1', invoiceSlug: 'invoice-1' }
const purchase = { id: 'purchase-1', payment_provider: 'infinitepay', provider_order_nsu: hint.orderNsu,
  provider_transaction_nsu: null, provider_invoice_slug: null, package_id: 'pack_25',
  amount_centavos: 590, currency: 'BRL', status: 'pending' }
function fixtures({ row = purchase, check = { success: true, paid: true, amount: 590, capture_method: 'pix' } } = {}) {
  const calls = []
  const query = { select: () => query, eq: (key, value) => { calls.push(['filter', key, value]); return query },
    maybeSingle: async () => ({ data: row, error: null }) }
  const admin = { from: () => query, rpc: async (name, params) => { calls.push(['rpc', name, params]); return { data: { credited: true }, error: null } } }
  const fetcher = async (url, options) => { calls.push(['fetch', url, JSON.parse(options.body)]); return { ok: true, json: async () => check } }
  return { admin, handle: 'merchant', hint, fetcher, calls }
}

test('valid Pix and card use payment_check before the same credit RPC', async () => {
  for (const method of ['pix', 'credit_card']) {
    const deps = fixtures({ check: { success: true, paid: true, amount: 590, capture_method: method } })
    assert.equal((await verifyAndConfirm(deps)).confirmed, true)
    assert.equal(deps.calls.find((call) => call[0] === 'fetch')[2].order_nsu, hint.orderNsu)
    assert.equal(deps.calls.find((call) => call[0] === 'rpc')[2].p_capture_method, method)
  }
})

test('false webhook, unpaid response, amount mismatch and unknown order never credit', async () => {
  assert.throws(() => paymentHint({ order_nsu: '../bad', transaction_nsu: 'x', slug: 'x' }), /INVALID_PAYMENT_HINT/)
  const unpaid = fixtures({ check: { success: true, paid: false, amount: 590 } })
  assert.equal((await verifyAndConfirm(unpaid)).confirmed, false)
  assert.equal(unpaid.calls.some((call) => call[0] === 'rpc'), false)
  const wrongAmount = fixtures({ check: { success: true, paid: true, amount: 591, capture_method: 'pix' } })
  await assert.rejects(verifyAndConfirm(wrongAmount), /PAYMENT_MISMATCH/)
  assert.equal(wrongAmount.calls.some((call) => call[0] === 'rpc'), false)
  await assert.rejects(verifyAndConfirm(fixtures({ row: null })), /PURCHASE_NOT_FOUND/)
})

test('duplicate notification does not call payment_check again', async () => {
  const deps = fixtures({ row: { ...purchase, status: 'credited', provider_transaction_nsu: hint.transactionNsu,
    provider_invoice_slug: hint.invoiceSlug }, fetcher: () => { throw new Error('called') } })
  assert.equal((await verifyAndConfirm(deps)).status, 'credited')
  assert.equal(deps.calls.some((call) => call[0] === 'rpc' || call[0] === 'fetch'), false)
})

test('customer return is scoped to the authenticated user', async () => {
  const deps = fixtures()
  await verifyAndConfirm({ ...deps, userId: 'user-1' })
  assert.ok(deps.calls.some((call) => call[0] === 'filter' && call[1] === 'user_id' && call[2] === 'user-1'))
})

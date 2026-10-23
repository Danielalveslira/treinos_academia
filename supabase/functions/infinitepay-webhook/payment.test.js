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
  const admin = { from: () => query, rpc: async (name, params) => { calls.push(['rpc', name, params]); return { data: name === 'claim_infinitepay_payment_check' ? true : { credited: true }, error: null } } }
  const fetcher = async (url, options) => { calls.push(['fetch', url, JSON.parse(options.body)]); return Response.json(check) }
  return { admin, handle: 'merchant', hint, fetcher, calls }
}

test('valid Pix and card use payment_check before the same credit RPC', async () => {
  for (const method of ['pix', 'credit_card']) {
    const deps = fixtures({ check: { success: true, paid: true, amount: 590, capture_method: method } })
    assert.equal((await verifyAndConfirm(deps)).confirmed, true)
    assert.equal(deps.calls.find((call) => call[0] === 'fetch')[2].order_nsu, hint.orderNsu)
    assert.equal(deps.calls.find((call) => call[0] === 'rpc' && call[1] === 'confirm_infinitepay_cash_purchase')[2].p_capture_method, method)
  }
})

test('false webhook, unpaid response, amount mismatch and unknown order never credit', async () => {
  assert.throws(() => paymentHint({ order_nsu: '../bad', transaction_nsu: 'x', slug: 'x' }), /INVALID_PAYMENT_HINT/)
  const unpaid = fixtures({ check: { success: true, paid: false, amount: 590 } })
  assert.equal((await verifyAndConfirm(unpaid)).confirmed, false)
  assert.equal(unpaid.calls.some((call) => call[1] === 'confirm_infinitepay_cash_purchase'), false)
  const wrongAmount = fixtures({ check: { success: true, paid: true, amount: 591, capture_method: 'pix' } })
  await assert.rejects(verifyAndConfirm(wrongAmount), /PAYMENT_MISMATCH/)
  assert.equal(wrongAmount.calls.some((call) => call[1] === 'confirm_infinitepay_cash_purchase'), false)
  await assert.rejects(verifyAndConfirm(fixtures({ row: null })), /PURCHASE_NOT_FOUND/)
})

test('duplicate notification does not call payment_check again', async () => {
  const deps = fixtures({ row: { ...purchase, status: 'credited', provider_transaction_nsu: hint.transactionNsu,
    provider_invoice_slug: hint.invoiceSlug }, fetcher: () => { throw new Error('called') } })
  assert.equal((await verifyAndConfirm(deps)).status, 'credited')
  assert.equal(deps.calls.some((call) => call[0] === 'rpc' || call[0] === 'fetch'), false)
})

test('cancelled checkout is checked, unpaid remains cancelled and paid settles once', async () => {
  const cancelled = { ...purchase, status: 'cancelled' }
  const unpaid = fixtures({ row: cancelled, check: { success: true, paid: false, amount: 590 } })
  assert.deepEqual(await verifyAndConfirm(unpaid), { status: 'cancelled', confirmed: false })
  assert.equal(unpaid.calls.some((call) => call[1] === 'confirm_infinitepay_cash_purchase'), false)
  const paid = fixtures({ row: cancelled })
  assert.deepEqual(await verifyAndConfirm(paid), { status: 'credited', confirmed: true })
  assert.equal(paid.calls.filter((call) => call[0] === 'fetch').length, 1)
  assert.equal(paid.calls.filter((call) => call[1] === 'confirm_infinitepay_cash_purchase').length, 1)
  const replay = fixtures({ row: { ...cancelled, status: 'credited', provider_transaction_nsu: hint.transactionNsu,
    provider_invoice_slug: hint.invoiceSlug } })
  assert.equal((await verifyAndConfirm(replay)).status, 'credited')
  assert.equal(replay.calls.some((call) => call[0] === 'rpc'), false)
})

test('customer return is scoped to the authenticated user', async () => {
  const deps = fixtures()
  await verifyAndConfirm({ ...deps, userId: 'user-1' })
  assert.ok(deps.calls.some((call) => call[0] === 'filter' && call[1] === 'user_id' && call[2] === 'user-1'))
})

test('provider contract mismatches, including optional identities/currency, never confirm', async () => {
  for (const change of [{ currency: 'USD' }, { order_nsu: 'another-order' }, { transaction_nsu: 'another-txn' },
    { invoice_slug: 'another-invoice' }, { capture_method: 'debit_card' }, { amount: 590.5 }, { amount: Number.MAX_SAFE_INTEGER + 1 }]) {
    const deps = fixtures({ check: { success: true, paid: true, amount: 590, capture_method: 'pix', ...change } })
    await assert.rejects(verifyAndConfirm(deps), /PAYMENT_MISMATCH/)
    assert.equal(deps.calls.some((call) => call[1] === 'confirm_infinitepay_cash_purchase'), false)
  }
})

test('provider timeout, 500, malformed and oversized responses never confirm', async () => {
  const responses = [
    async () => { throw new DOMException('timeout', 'TimeoutError') },
    async () => new Response('{}', { status: 500 }),
    async () => new Response('{'),
    async () => new Response('x'.repeat(65537)),
  ]
  for (const fetcher of responses) {
    const deps = fixtures()
    await assert.rejects(verifyAndConfirm({ ...deps, fetcher }))
    assert.equal(deps.calls.some((call) => call[1] === 'confirm_infinitepay_cash_purchase'), false)
  }
})

test('persisted lease prevents provider calls; review/refund terminal states acknowledge replays', async () => {
  const deps = fixtures()
  deps.admin.rpc = async () => ({ data: false, error: null })
  assert.equal((await verifyAndConfirm(deps)).confirmed, false)
  assert.equal(deps.calls.some((call) => call[0] === 'fetch'), false)
  for (const row of [{ ...purchase, status: 'needs_review' }, { ...purchase, status: 'cancelled', review_resolution: 'refunded_externally' }]) {
    const terminal = fixtures({ row })
    assert.equal((await verifyAndConfirm(terminal)).confirmed, true)
    assert.equal(terminal.calls.some((call) => call[0] === 'fetch'), false)
  }
})

test('100 simulated repeated deliveries of an already credited purchase never invoke gateway or credit', async () => {
  const deps = fixtures({ row: { ...purchase, status: 'credited' } })
  const results = await Promise.all(Array.from({ length: 100 }, () => verifyAndConfirm(deps)))
  assert.ok(results.every((r) => r.confirmed))
  assert.equal(deps.calls.some((call) => call[0] === 'fetch' || call[0] === 'rpc'), false)
})

test('payment identifiers must be strings, never coercible arrays or objects', () => {
  assert.throws(() => paymentHint({ order_nsu: [hint.orderNsu], transaction_nsu: hint.transactionNsu, slug: hint.invoiceSlug }), /INVALID_PAYMENT_HINT/)
  assert.throws(() => paymentHint({ order_nsu: hint.orderNsu, transaction_nsu: [hint.transactionNsu], slug: hint.invoiceSlug }), /INVALID_PAYMENT_HINT/)
})

test('a second VERIFIED transaction on a reusable legacy link is recorded for review, never credited again', async () => {
  const deps = fixtures({ row: { ...purchase, status: 'credited', provider_transaction_nsu: 'previous-paid-transaction', provider_invoice_slug: hint.invoiceSlug } })
  const result = await verifyAndConfirm(deps)
  assert.deepEqual(result, { status: 'needs_review', confirmed: true })
  assert.ok(deps.calls.some((call) => call[1] === 'record_infinitepay_verified_conflict'))
  assert.equal(deps.calls.some((call) => call[1] === 'confirm_infinitepay_cash_purchase'), false)
})

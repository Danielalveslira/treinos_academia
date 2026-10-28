import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileBatch } from './batch.js'

test('bounded batch does not guess missing payment identities and empty retry is safe', async () => {
  const calls = []
  const admin = { rpc: async (name, params) => { calls.push([name, params]); return { data: [], error: null } } }
  assert.deepEqual(await reconcileBatch({ admin }), { checked: 0, confirmed: 0, failed: 0 })
  assert.deepEqual(calls[0], ['claim_infinitepay_reconciliation_batch', { p_limit: 2 }])
  await assert.rejects(reconcileBatch({ admin, limit: 26 }), /INVALID_BATCH_SIZE/)
})

test('provider failures do not abort subsequent batch items or fabricate success', async () => {
  const row = { id: 'test', status: 'pending',  amount_centavos: 590, currency: 'BRL' }
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row }) }
  let fetched = 0
  const admin = { from: () => query, rpc: async (name) => ({ data: name === 'claim_infinitepay_reconciliation_batch'
    ? [{ orderNsu: 'order1', transactionNsu: 'txn1', invoiceSlug: 'inv1' }, { orderNsu: 'order2', transactionNsu: 'txn2', invoiceSlug: 'inv2' }]
    : name === 'claim_infinitepay_payment_check' ? true : { credited: true } }) }
  const result = await reconcileBatch({ admin, handle: 'test', fetcher: async () => {
    if (++fetched === 1) throw new Error('provider unavailable')
    return Response.json({ success: true, paid: true, amount: 590, capture_method: 'pix' })
  } })
  assert.deepEqual(result, { checked: 1, confirmed: 1, failed: 1 })
})

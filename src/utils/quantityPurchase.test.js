import test from 'node:test'
import assert from 'node:assert/strict'
import { checkoutRequestId, purchaseError } from './quantityPurchase.js'
test('checkout idempotency survives reload and is isolated by owner and quote', () => {
  const values = new Map()
  const storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) }
  const first = 'a1000000-0000-0000-0000-000000000001'
  assert.equal(
    checkoutRequestId('user-a', 'quote-a', storage, () => first),
    first
  )
  assert.equal(
    checkoutRequestId('user-a', 'quote-a', storage, () => {
      throw Error('must reuse')
    }),
    first
  )
  assert.notEqual(
    checkoutRequestId('user-b', 'quote-a', storage, () => 'b1000000-0000-0000-0000-000000000001'),
    first
  )
  assert.notEqual(
    checkoutRequestId('user-a', 'quote-b', storage, () => 'c1000000-0000-0000-0000-000000000001'),
    first
  )
  assert.throws(
    () =>
      checkoutRequestId('u', 'q', {
        getItem() {
          throw Error('storage blocked')
        },
      }),
    /storage blocked/
  )
})
test('uncertain provider outcome asks for reconciliation instead of another payment', () => {
  assert.match(
    purchaseError({ message: 'CHECKOUT_RECONCILIATION_REQUIRED' }),
    /não faça outro pagamento/
  )
  assert.match(purchaseError({ message: 'QUOTE_EXPIRED' }), /Atualize/)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { economyTransactionAmount, economyTransactionLabel } from './economyGuide.js'

test('ledger labels and amounts distinguish credits and debits for both currencies', () => {
  assert.equal(economyTransactionLabel({ reason: 'vote_reward' }), 'Apoio recebido')
  assert.equal(economyTransactionLabel({ reason: 'cash_purchase_confirmed' }), 'Compra confirmada')
  assert.equal(economyTransactionLabel({ reason: 'unknown', direction: 'debit' }), 'Uso')
  assert.equal(
    economyTransactionAmount({ asset: 'coin', direction: 'credit', amount: 12 }),
    '+12 EvoCoins'
  )
  assert.equal(
    economyTransactionAmount({ asset: 'cash', direction: 'debit', amount: 25 }),
    '−25 EvoCash'
  )
})

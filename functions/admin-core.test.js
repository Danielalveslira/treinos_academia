import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountView } from './admin-core.js'

test('administrative identity comes from document path, never profile data', () => {
  assert.deepEqual(
    accountView(
      'real',
      { id: 'victim', email: 'fake', username: 'alice', secret: 'private' },
      'real@example.com'
    ),
    { id: 'real', email: 'real@example.com', username: 'alice' }
  )
})
test('account view serializes subscription timestamps', () => {
  assert.equal(
    accountView('real', { subscription: { paidAt: { toDate: () => new Date('2026-01-01') } } })
      .subscription.paidAt,
    '2026-01-01T00:00:00.000Z'
  )
})

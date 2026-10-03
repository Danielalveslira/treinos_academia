import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canModerateCommunity } from './communityOwnership.js'

test('canModerateCommunity: the owner of that exact community can moderate it', () => {
  assert.equal(
    canModerateCommunity({ isSuperAdmin: false, communityOwnerId: 'alice', uid: 'alice' }),
    true
  )
})

test('canModerateCommunity: the owner of a DIFFERENT community cannot moderate this one', () => {
  assert.equal(
    canModerateCommunity({ isSuperAdmin: false, communityOwnerId: 'bob', uid: 'alice' }),
    false
  )
})

test('canModerateCommunity: superadmin can moderate any community, even one they do not own', () => {
  assert.equal(
    canModerateCommunity({ isSuperAdmin: true, communityOwnerId: 'bob', uid: 'alice' }),
    true
  )
})

test('canModerateCommunity: a regular user with no relation to the community cannot moderate it', () => {
  assert.equal(
    canModerateCommunity({ isSuperAdmin: false, communityOwnerId: null, uid: 'alice' }),
    false
  )
  assert.equal(
    canModerateCommunity({ isSuperAdmin: false, communityOwnerId: undefined, uid: 'alice' }),
    false
  )
})

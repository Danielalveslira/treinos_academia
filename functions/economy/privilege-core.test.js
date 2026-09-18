import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createCommunityIdFromRequest,
  isValidCommunityCreationInput,
  communityCreationInputMatches,
  isValidCreateCommunityPrivilege,
  createCommunityEligibilityReason,
} from './privilege-core.js'

test('createCommunityIdFromRequest is deterministic and differs per uid/requestId', () => {
  assert.equal(createCommunityIdFromRequest('u1', 'r1'), createCommunityIdFromRequest('u1', 'r1'))
  assert.notEqual(createCommunityIdFromRequest('u1', 'r1'), createCommunityIdFromRequest('u2', 'r1'))
  assert.notEqual(createCommunityIdFromRequest('u1', 'r1'), createCommunityIdFromRequest('u1', 'r2'))
})

test('createCommunityIdFromRequest never collides with cashPurchaseIdFromRequest for the same uid/requestId', async () => {
  const { cashPurchaseIdFromRequest } = await import('./cash-purchase-core.js')
  assert.notEqual(createCommunityIdFromRequest('u1', 'r1'), cashPurchaseIdFromRequest('u1', 'r1'))
})

const VALID_INPUT = { name: 'Corrida de Rua', description: 'Para quem ama correr', iconName: 'flame' }

test('isValidCommunityCreationInput accepts a well-formed input', () => {
  assert.equal(isValidCommunityCreationInput(VALID_INPUT), true)
})

test('isValidCommunityCreationInput accepts an empty/absent description', () => {
  assert.equal(isValidCommunityCreationInput({ ...VALID_INPUT, description: '' }), true)
  assert.equal(isValidCommunityCreationInput({ ...VALID_INPUT, description: undefined }), true)
})

test('isValidCommunityCreationInput rejects malformed name', () => {
  for (const bad of ['', '   ', 'x'.repeat(61), null, undefined, 42]) {
    assert.equal(isValidCommunityCreationInput({ ...VALID_INPUT, name: bad }), false)
  }
})

test('isValidCommunityCreationInput rejects an over-long description', () => {
  assert.equal(isValidCommunityCreationInput({ ...VALID_INPUT, description: 'x'.repeat(301) }), false)
})

test('isValidCommunityCreationInput rejects an icon outside the whitelist', () => {
  for (const bad of ['not-a-real-icon', '', null, undefined, 42]) {
    assert.equal(isValidCommunityCreationInput({ ...VALID_INPUT, iconName: bad }), false)
  }
})

test('communityCreationInputMatches: identical payload matches, trimming whitespace like the writer does', () => {
  const existing = { name: 'Corrida de Rua', description: 'Para quem ama correr', iconName: 'flame' }
  assert.equal(communityCreationInputMatches(existing, { name: '  Corrida de Rua  ', description: 'Para quem ama correr', iconName: 'flame' }), true)
})

test('communityCreationInputMatches: a different name/description/icon is a conflict, not a replay', () => {
  const existing = { name: 'Corrida de Rua', description: 'Para quem ama correr', iconName: 'flame' }
  assert.equal(communityCreationInputMatches(existing, { ...VALID_INPUT, name: 'Outro nome' }), false)
  assert.equal(communityCreationInputMatches(existing, { ...VALID_INPUT, description: 'Outra descrição' }), false)
  assert.equal(communityCreationInputMatches(existing, { ...VALID_INPUT, iconName: 'star' }), false)
})

const VALID_PRIVILEGE = {
  minimumLifetimeCoins: 200,
  minimumAccountAgeDays: 7,
  requireEmailVerified: true,
  cashCost: 50,
}

test('isValidCreateCommunityPrivilege accepts a well-formed config block', () => {
  assert.equal(isValidCreateCommunityPrivilege(VALID_PRIVILEGE), true)
})

test('isValidCreateCommunityPrivilege rejects a missing/null/non-object value (config ausente/corrompida)', () => {
  assert.equal(isValidCreateCommunityPrivilege(undefined), false)
  assert.equal(isValidCreateCommunityPrivilege(null), false)
  assert.equal(isValidCreateCommunityPrivilege('x'), false)
})

for (const field of ['minimumLifetimeCoins', 'minimumAccountAgeDays', 'cashCost']) {
  test(`isValidCreateCommunityPrivilege rejects malformed ${field}`, () => {
    for (const bad of [-1, 1.5, NaN, Infinity, '1', null, undefined]) {
      assert.equal(isValidCreateCommunityPrivilege({ ...VALID_PRIVILEGE, [field]: bad }), false)
    }
  })
}

test('isValidCreateCommunityPrivilege requires requireEmailVerified to be a strict boolean', () => {
  for (const bad of ['true', 1, 0, null, undefined]) {
    assert.equal(isValidCreateCommunityPrivilege({ ...VALID_PRIVILEGE, requireEmailVerified: bad }), false)
  }
})

const NOW = Date.parse('2026-06-01T12:00:00-03:00')
const OLD_ENOUGH = NOW - 30 * 86400000
const eligibleInput = () => ({
  accountStatus: 'active',
  restriction: null,
  accountCreatedAtMs: OLD_ENOUGH,
  emailVerified: true,
  lifetimeCoinsEarned: 500,
  cashBalance: 100,
  privilege: VALID_PRIVILEGE,
  nowMs: NOW,
})

test('createCommunityEligibilityReason returns null when every requirement is met', () => {
  assert.equal(createCommunityEligibilityReason(eligibleInput()), null)
})

test('createCommunityEligibilityReason: disabled account blocks first, regardless of anything else', () => {
  assert.equal(
    createCommunityEligibilityReason({ ...eligibleInput(), accountStatus: 'disabled', cashBalance: 0 }),
    'account_disabled'
  )
})

test('createCommunityEligibilityReason: an active restriction blocks; an expired temporary_suspension does not', () => {
  assert.equal(
    createCommunityEligibilityReason({
      ...eligibleInput(),
      restriction: { action: 'temporary_suspension', until: NOW + 1000 },
    }),
    'account_restricted'
  )
  assert.equal(
    createCommunityEligibilityReason({
      ...eligibleInput(),
      restriction: { action: 'system_ban', until: null },
    }),
    'account_restricted',
    'system_ban nunca expira, mesmo com until no passado'
  )
  assert.equal(
    createCommunityEligibilityReason({
      ...eligibleInput(),
      restriction: { action: 'temporary_suspension', until: NOW - 1000 },
    }),
    null
  )
})

test('createCommunityEligibilityReason: account too new blocks', () => {
  assert.equal(
    createCommunityEligibilityReason({ ...eligibleInput(), accountCreatedAtMs: NOW - 86400000 }),
    'account_too_new'
  )
})

test('createCommunityEligibilityReason: unverified email blocks only when required by config', () => {
  assert.equal(
    createCommunityEligibilityReason({ ...eligibleInput(), emailVerified: false }),
    'email_not_verified'
  )
  assert.equal(
    createCommunityEligibilityReason({
      ...eligibleInput(),
      emailVerified: false,
      privilege: { ...VALID_PRIVILEGE, requireEmailVerified: false },
    }),
    null
  )
})

test('createCommunityEligibilityReason: insufficient reputation blocks', () => {
  assert.equal(
    createCommunityEligibilityReason({ ...eligibleInput(), lifetimeCoinsEarned: 199 }),
    'insufficient_reputation'
  )
})

test('createCommunityEligibilityReason: insufficient EvoCash blocks', () => {
  assert.equal(createCommunityEligibilityReason({ ...eligibleInput(), cashBalance: 49 }), 'insufficient_cash')
})

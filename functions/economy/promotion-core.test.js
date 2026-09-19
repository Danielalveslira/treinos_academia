import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createPromotionIdFromRequest,
  isValidPromotionPackage,
  promotionInputMatches,
  resolvePromotionBlockReason,
  computePromotionExpiryMs,
  isTargetCurrentlyPromoted,
  promotionMatchesTarget,
  isPromotionCurrentlyActive,
} from './promotion-core.js'

test('createPromotionIdFromRequest is deterministic for the same uid+requestId, differs otherwise', () => {
  const base = createPromotionIdFromRequest('u1', 'r1')
  assert.equal(base, createPromotionIdFromRequest('u1', 'r1'))
  assert.notEqual(base, createPromotionIdFromRequest('u2', 'r1'))
  assert.notEqual(base, createPromotionIdFromRequest('u1', 'r2'))
})

const VALID_PACKAGE = { targetType: 'post', cashAmount: 25, durationDays: 3, label: 'Destaque 3 dias' }

test('isValidPromotionPackage accepts a well-formed package', () => {
  assert.equal(isValidPromotionPackage(VALID_PACKAGE), true)
  assert.equal(isValidPromotionPackage({ ...VALID_PACKAGE, targetType: 'community' }), true)
})

test('isValidPromotionPackage rejects a missing/null/non-object value', () => {
  assert.equal(isValidPromotionPackage(undefined), false)
  assert.equal(isValidPromotionPackage(null), false)
  assert.equal(isValidPromotionPackage('x'), false)
})

test('isValidPromotionPackage rejects an unknown targetType', () => {
  assert.equal(isValidPromotionPackage({ ...VALID_PACKAGE, targetType: 'ad' }), false)
  assert.equal(isValidPromotionPackage({ ...VALID_PACKAGE, targetType: undefined }), false)
})

for (const field of ['cashAmount', 'durationDays']) {
  test(`isValidPromotionPackage rejects malformed ${field}`, () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, '3', null, undefined]) {
      assert.equal(isValidPromotionPackage({ ...VALID_PACKAGE, [field]: bad }), false, `${field}=${bad}`)
    }
  })
}

test('isValidPromotionPackage rejects durationDays above the sanity ceiling (90)', () => {
  assert.equal(isValidPromotionPackage({ ...VALID_PACKAGE, durationDays: 91 }), false)
  assert.equal(isValidPromotionPackage({ ...VALID_PACKAGE, durationDays: 90 }), true)
})

test('isValidPromotionPackage rejects malformed label', () => {
  for (const bad of ['', '   ', 'x'.repeat(81), 42, null, undefined]) {
    assert.equal(isValidPromotionPackage({ ...VALID_PACKAGE, label: bad }), false)
  }
})

test('promotionInputMatches: same targetType/targetId/packageId matches, anything different does not', () => {
  const existing = { targetType: 'post', targetId: 's1', packageId: 'post_boost_3d' }
  assert.equal(promotionInputMatches(existing, existing), true)
  assert.equal(promotionInputMatches(existing, { ...existing, targetId: 's2' }), false)
  assert.equal(promotionInputMatches(existing, { ...existing, packageId: 'post_boost_7d' }), false)
  assert.equal(promotionInputMatches(existing, { ...existing, targetType: 'community' }), false)
})

test('computePromotionExpiryMs derives expiresAt from the SAME nowMs used for startedAt', () => {
  const nowMs = 1_000_000
  assert.equal(computePromotionExpiryMs(nowMs, 3), nowMs + 3 * 86400000)
  assert.equal(computePromotionExpiryMs(nowMs, 7), nowMs + 7 * 86400000)
})

test('isTargetCurrentlyPromoted is true only while promoted and within the window', () => {
  assert.equal(isTargetCurrentlyPromoted({ promoted: true, promotedUntilMs: 2000 }, 1000), true)
  assert.equal(isTargetCurrentlyPromoted({ promoted: true, promotedUntilMs: 500 }, 1000), false, 'já expirou')
  assert.equal(isTargetCurrentlyPromoted({ promoted: false, promotedUntilMs: 2000 }, 1000), false)
  assert.equal(isTargetCurrentlyPromoted(null, 1000), false)
  assert.equal(isTargetCurrentlyPromoted({}, 1000), false)
})

const BASE_CHECK = {
  targetExists: true,
  isOwner: true,
  accountStatus: 'active',
  accountRestriction: null,
  nowMs: 1000,
  isCurrentMember: true,
  communityMembershipRestrictionExists: false,
  communityDeletionJobExists: false,
  communityIsActive: true,
  targetAlreadyPromoted: false,
  packageValid: true,
  packageTargetTypeMatches: true,
  cashBalance: 100,
  cashCost: 25,
}

test('resolvePromotionBlockReason: all checks passing returns null', () => {
  assert.equal(resolvePromotionBlockReason(BASE_CHECK), null)
})

test('resolvePromotionBlockReason: target missing', () => {
  assert.equal(resolvePromotionBlockReason({ ...BASE_CHECK, targetExists: false }), 'target_not_found')
})

test('resolvePromotionBlockReason: not the owner (post authorId / community ownerId mismatch)', () => {
  assert.equal(resolvePromotionBlockReason({ ...BASE_CHECK, isOwner: false }), 'not_owner')
})

test('resolvePromotionBlockReason: disabled account', () => {
  assert.equal(resolvePromotionBlockReason({ ...BASE_CHECK, accountStatus: 'disabled' }), 'account_disabled')
})

test('resolvePromotionBlockReason: active account restriction blocks; expired temporary_suspension does not', () => {
  assert.equal(
    resolvePromotionBlockReason({ ...BASE_CHECK, accountRestriction: { action: 'system_ban', untilMs: null } }),
    'account_restricted'
  )
  assert.equal(
    resolvePromotionBlockReason({
      ...BASE_CHECK,
      accountRestriction: { action: 'temporary_suspension', untilMs: 500 },
    }),
    null
  )
  assert.equal(
    resolvePromotionBlockReason({
      ...BASE_CHECK,
      accountRestriction: { action: 'temporary_suspension', untilMs: 2000 },
    }),
    'account_restricted'
  )
})

test('resolvePromotionBlockReason: author who left the community (or was never a member) cannot promote the post', () => {
  assert.equal(resolvePromotionBlockReason({ ...BASE_CHECK, isCurrentMember: false }), 'not_a_member')
})

test('resolvePromotionBlockReason: author banned from the community (communityRestrictions) cannot promote, even with authorId matching', () => {
  assert.equal(
    resolvePromotionBlockReason({ ...BASE_CHECK, communityMembershipRestrictionExists: true }),
    'community_restricted'
  )
})

test('resolvePromotionBlockReason: community deletion job in progress, or community inactive', () => {
  assert.equal(
    resolvePromotionBlockReason({ ...BASE_CHECK, communityDeletionJobExists: true }),
    'community_unavailable'
  )
  assert.equal(resolvePromotionBlockReason({ ...BASE_CHECK, communityIsActive: false }), 'community_unavailable')
})

test('resolvePromotionBlockReason: target already has an active, non-expired promotion', () => {
  assert.equal(resolvePromotionBlockReason({ ...BASE_CHECK, targetAlreadyPromoted: true }), 'already_promoted')
})

test('resolvePromotionBlockReason: invalid package or targetType mismatch (buying a community package for a post)', () => {
  assert.equal(resolvePromotionBlockReason({ ...BASE_CHECK, packageValid: false }), 'invalid_package')
  assert.equal(resolvePromotionBlockReason({ ...BASE_CHECK, packageTargetTypeMatches: false }), 'invalid_package')
})

test('resolvePromotionBlockReason: insufficient EvoCash balance', () => {
  assert.equal(resolvePromotionBlockReason({ ...BASE_CHECK, cashBalance: 24, cashCost: 25 }), 'insufficient_cash')
  assert.equal(resolvePromotionBlockReason({ ...BASE_CHECK, cashBalance: 25, cashCost: 25 }), null)
})

test('resolvePromotionBlockReason: first applicable reason wins (ordering)', () => {
  // sem o alvo, nem dono nem saldo importam mais.
  assert.equal(
    resolvePromotionBlockReason({ ...BASE_CHECK, targetExists: false, isOwner: false, cashBalance: 0 }),
    'target_not_found'
  )
})

// recordPromotionEvent: revalidação antes de incrementar (nunca confia só em
// activePromotionId vindo do cliente).
test('promotionMatchesTarget: only true when both targetType and targetId match exactly', () => {
  const promotion = { targetType: 'post', targetId: 's1' }
  assert.equal(promotionMatchesTarget(promotion, { targetType: 'post', targetId: 's1' }), true)
  assert.equal(promotionMatchesTarget(promotion, { targetType: 'post', targetId: 's2' }), false)
  assert.equal(promotionMatchesTarget(promotion, { targetType: 'community', targetId: 's1' }), false)
  assert.equal(promotionMatchesTarget(null, { targetType: 'post', targetId: 's1' }), false)
})

test('isPromotionCurrentlyActive: true only for status active AND not yet expired -- never status alone', () => {
  assert.equal(isPromotionCurrentlyActive({ status: 'active', expiresAtMs: 2000 }, 1000), true)
  assert.equal(isPromotionCurrentlyActive({ status: 'active', expiresAtMs: 500 }, 1000), false, 'expirado')
  assert.equal(isPromotionCurrentlyActive({ status: 'cancelled', expiresAtMs: 2000 }, 1000), false)
  assert.equal(isPromotionCurrentlyActive({ status: 'target_removed', expiresAtMs: 2000 }, 1000), false)
  assert.equal(isPromotionCurrentlyActive(null, 1000), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { USAGE_PROFILES, isValidUsageProfile, isEligibleForListingCreation } from './usage-profile-core.js'

test('USAGE_PROFILES has exactly the three declared options', () => {
  assert.deepEqual(USAGE_PROFILES, ['common', 'professional', 'establishment_owner'])
})

test('isValidUsageProfile accepts only the three declared values', () => {
  for (const value of USAGE_PROFILES) assert.equal(isValidUsageProfile(value), true)
  assert.equal(isValidUsageProfile('superadmin'), false)
  assert.equal(isValidUsageProfile('space'), false)
  assert.equal(isValidUsageProfile(''), false)
  assert.equal(isValidUsageProfile(undefined), false)
  assert.equal(isValidUsageProfile(null), false)
})

test('isEligibleForListingCreation allows only professional and establishment_owner', () => {
  assert.equal(isEligibleForListingCreation('professional'), true)
  assert.equal(isEligibleForListingCreation('establishment_owner'), true)
  assert.equal(isEligibleForListingCreation('common'), false)
  assert.equal(isEligibleForListingCreation(undefined), false)
})

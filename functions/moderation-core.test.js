import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isProtectedRole, isSelfReport } from './moderation-core.js'

test('superadmin and admin roles are protected from reports and penalties', () => {
  assert.equal(isProtectedRole('superadmin'), true)
  assert.equal(isProtectedRole('admin'), true)
})

test('regular users and missing/forged roles are not protected', () => {
  assert.equal(isProtectedRole('user'), false)
  assert.equal(isProtectedRole(undefined), false)
  assert.equal(isProtectedRole(''), false)
  assert.equal(isProtectedRole('superadmin '), false)
})

test('a user reporting their own publication is a self-report', () => {
  assert.equal(isSelfReport('owner', 'owner'), true)
  assert.equal(isSelfReport('owner', 'visitor'), false)
  assert.equal(isSelfReport(undefined, undefined), true)
})

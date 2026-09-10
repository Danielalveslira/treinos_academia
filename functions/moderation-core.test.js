import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isProtectedRole } from './moderation-core.js'

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

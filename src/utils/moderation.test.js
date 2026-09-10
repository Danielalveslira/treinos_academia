import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isReportableAuthor } from './moderation.js'

test('the report button never appears for admin content or for your own publication', () => {
  const status = { authorId: 'owner', authorIsSuperAdmin: false }
  assert.equal(isReportableAuthor(status, 'visitor'), true)
  assert.equal(isReportableAuthor(status, 'owner'), false)
  assert.equal(isReportableAuthor({ ...status, authorIsSuperAdmin: true }, 'visitor'), false)
})

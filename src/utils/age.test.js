import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateAge } from './age.js'

test('calculateAge counts full years, only crediting the birthday once it has actually passed', () => {
  const now = new Date(2026, 8, 10) // 2026-09-10
  assert.equal(calculateAge('2000-09-10', now), 26) // birthday is today
  assert.equal(calculateAge('2000-09-09', now), 26) // birthday was yesterday
  assert.equal(calculateAge('2000-09-11', now), 25) // birthday is tomorrow
  assert.equal(calculateAge('2008-01-01', now), 18)
  assert.equal(calculateAge('2026-09-10', now), 0) // born today
})

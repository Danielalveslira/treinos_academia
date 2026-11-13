import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampInitialDays, validCommercialPrice, commercialError } from './commercial.js'
test('commercial limits use integer arithmetic through the int4 financial boundary', () => {
  assert.equal(validCommercialPrice('2147483647', '1', '1'), true)
  for (const tuple of [
    ['2147483647', '1', '2'],
    ['0', '1', '2'],
    ['2.5', '1', '2'],
    ['1', '0', '1'],
    ['1', '2', '1'],
    ['1', '1', '3651'],
    ['NaN', '1', '2'],
  ])
    assert.equal(validCommercialPrice(...tuple), false)
  assert.equal(validCommercialPrice('2', '1', '3650'), true)
})
test('pending approval, expired quotes and suspension have safe actionable errors', () => {
  assert.match(commercialError({ message: 'RESOURCE_NOT_ELIGIBLE' }), /aprovado/)
  assert.match(commercialError({ message: 'ENTITLEMENT_BLOCKED' }), /não remove/)
  assert.match(commercialError({ message: 'QUOTE_EXPIRED' }), /nova/)
  assert.doesNotMatch(commercialError({ message: 'secret raw backend error' }), /secret/)
})
test('a desired duration chosen in the ad wizard pre-fills the contract step, clamped to the live tariff', () => {
  assert.equal(clampInitialDays(null, { minDays: 1, maxDays: 30 }), '1')
  assert.equal(clampInitialDays(null, { minDays: 5, maxDays: 30 }), '5')
  assert.equal(clampInitialDays(7, { minDays: 1, maxDays: 30 }), '7')
  assert.equal(clampInitialDays(90, { minDays: 1, maxDays: 30 }), '30', 'above maxDays is clamped down, never rejected')
  assert.equal(clampInitialDays(1, { minDays: 5, maxDays: 30 }), '5', 'below minDays is clamped up')
  assert.equal(clampInitialDays(10, null), '10', 'no tariff yet falls back to a wide sane bound')
  assert.equal(clampInitialDays(99999, undefined), '3650')
})

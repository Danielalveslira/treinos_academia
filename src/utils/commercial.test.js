import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validCommercialPrice, commercialError } from './commercial.js'
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

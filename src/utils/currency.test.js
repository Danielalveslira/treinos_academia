import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digitsToCentavos, centavosToDigits } from './currency.js'

test('typing digits fills cents first, exactly like formatCentavosBRL displays them', () => {
  assert.equal(digitsToCentavos('4'), 4)
  assert.equal(digitsToCentavos('49'), 49)
  assert.equal(digitsToCentavos('499'), 499)
  assert.equal(digitsToCentavos('4990'), 4990) // R$ 49,90
})

test('non-digit characters (the currency mask itself) are ignored, never parsed as a decimal', () => {
  assert.equal(digitsToCentavos('R$ 49,90'), 4990)
  assert.equal(digitsToCentavos('R$ 1.234,56'), 123456)
})

test('empty or all-zero input means no price was informed (field is optional)', () => {
  assert.equal(digitsToCentavos(''), null)
  assert.equal(digitsToCentavos(null), null)
  assert.equal(digitsToCentavos(undefined), null)
  assert.equal(digitsToCentavos('0'), null)
  assert.equal(digitsToCentavos('000'), null)
})

test('leading zeros never produce a float artifact or an unsafe integer', () => {
  assert.equal(digitsToCentavos('007'), 7)
  assert.equal(digitsToCentavos('0049'), 49)
})

test('clamped to the backend-safe 12-digit boundary, never thrown or silently wrapped', () => {
  assert.equal(digitsToCentavos('999999999999'), 999999999999)
  assert.equal(digitsToCentavos('9999999999999999'), 999999999999)
})

test('round-trips with centavosToDigits for re-editing an existing product price', () => {
  assert.equal(centavosToDigits('4990'), '4990')
  assert.equal(centavosToDigits(4990), '4990')
  assert.equal(centavosToDigits(null), '')
  assert.equal(centavosToDigits(''), '')
  assert.equal(centavosToDigits('0'), '')
  assert.equal(digitsToCentavos(centavosToDigits('4990')), 4990)
})

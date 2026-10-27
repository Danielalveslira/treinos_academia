import test from 'node:test'
import assert from 'node:assert/strict'
import { formatPriceBRL, parsePriceBRL, priceForm, priceConfig } from './evocashPricing.js'
test('BRL inputs convert to exact integer strings, without floating point', () => {
  assert.equal(parsePriceBRL('0,29'), '29')
  assert.equal(parsePriceBRL('10,5'), '1050')
  assert.equal(parsePriceBRL('10'), '1000')
  for (const input of ['1.5', '1,999', '-1', 'NaN', '1e6', '01,20', ''])
    assert.throws(() => parsePriceBRL(input))
  assert.equal(formatPriceBRL('900719925474099399'), 'R$ 9.007.199.254.740.993,99')
  assert.equal(formatPriceBRL(null), '—')
})
test('blank form invents no commercial values; loaded version round-trips exactly', () => {
  assert.ok(Object.values(priceForm()).every((value) => value === ''))
  const version = {
    unitPriceCentavos: '29',
    minimumUnitPriceCentavos: '1',
    minQuantity: '1',
    maxQuantity: '1000',
    dailyQuantityLimit: '2000',
    totalQuantityLimit: '10000',
    quoteTtlSeconds: '300',
    largeChangeThresholdBps: '2000',
  }
  assert.deepEqual(priceConfig(priceForm(version)), version)
  assert.throws(() => priceConfig({ ...priceForm(version), minQuantity: '1.5' }))
})

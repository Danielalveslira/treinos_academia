import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDayPeriod, msUntilNextPeriod } from './dayPeriod.js'

const at = (hour, minute = 0) => new Date(2026, 9, 8, hour, minute, 0, 0)

test('06:00–17:59 is day (sun); 18:00–05:59 is night (moon)', () => {
  assert.equal(getDayPeriod(at(5, 59)), 'night')
  assert.equal(getDayPeriod(at(6)), 'day')
  assert.equal(getDayPeriod(at(12)), 'day')
  assert.equal(getDayPeriod(at(17, 59)), 'day')
  assert.equal(getDayPeriod(at(18)), 'night')
  assert.equal(getDayPeriod(at(0)), 'night')
})

test('the next switch lands right after the boundary, across midnight too', () => {
  const MIN = 60 * 1000
  assert.equal(msUntilNextPeriod(at(17, 30)), 30 * MIN + 1000)
  assert.equal(msUntilNextPeriod(at(5, 0)), 60 * MIN + 1000)
  assert.equal(msUntilNextPeriod(at(23, 0)), 7 * 60 * MIN + 1000)
  const after = new Date(at(17, 30).getTime() + msUntilNextPeriod(at(17, 30)))
  assert.equal(getDayPeriod(after), 'night')
})

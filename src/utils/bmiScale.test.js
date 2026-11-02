import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBmiScale } from './bmiScale.js'

test('adult BMI segments and marker share one proportional axis', () => {
  const scale = buildBmiScale(32.5, 59)
  assert.deepEqual(
    scale.segments.map(({ key }) => key),
    ['below', 'adequate', 'overweight', 'obesity-one', 'obesity-two', 'obesity-three']
  )
  assert.equal(scale.min, 15)
  assert.equal(scale.max, 45)
  assert.equal(scale.segments[0].width, ((18.5 - 15) / 30) * 100)
  assert.equal(scale.segments[1].left, scale.segments[0].width)
  assert.equal(scale.marker, ((32.5 - 15) / 30) * 100)
  assert.ok(Math.abs(scale.segments.reduce((sum, segment) => sum + segment.width, 0) - 100) < 1e-10)
})

test('elderly BMI uses its own 22 to 27 adequate band', () => {
  const scale = buildBmiScale(24.5, 60)
  assert.equal(scale.min, 17)
  assert.equal(scale.max, 32)
  assert.deepEqual(
    scale.segments.map(({ key }) => key),
    ['below', 'adequate', 'overweight']
  )
  assert.equal(scale.segments[1].left, ((22 - 17) / 15) * 100)
  assert.equal(scale.segments[1].width, ((27 - 22) / 15) * 100)
  assert.equal(scale.marker, ((24.5 - 17) / 15) * 100)
})

test('scale includes outliers without clipping the marker or changing numeric spacing', () => {
  const high = buildBmiScale(48, 40)
  assert.equal(high.max, 50)
  assert.equal(high.marker, ((48 - high.min) / (high.max - high.min)) * 100)
  assert.ok(high.marker < 100)
  assert.ok(high.segments.every(({ width }) => width > 0))

  const low = buildBmiScale(12, 60)
  assert.equal(low.min, 10)
  assert.ok(low.marker > 0)
})

test('scale is unavailable without an applicable age reference', () => {
  assert.equal(buildBmiScale(22, 19), null)
  assert.equal(buildBmiScale(22, null), null)
  assert.equal(buildBmiScale(null, 40), null)
})

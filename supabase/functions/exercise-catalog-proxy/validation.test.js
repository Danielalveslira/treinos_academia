import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_LIMIT,
  MAX_OFFSET,
  mapProviderRateLimitCode,
  parseBudget,
  validateDetailId,
  validateSearchParams,
} from './validation.js'

test('accepts a well-formed search and builds the exact query string ExerciseAPI expects', () => {
  const { search, error } = validateSearchParams({ q: 'supino', category: 'strength', limit: 10, offset: 0 })
  assert.equal(error, undefined)
  assert.equal(search.get('q'), 'supino')
  assert.equal(search.get('category'), 'strength')
  assert.equal(search.get('limit'), '10')
  assert.equal(search.get('offset'), '0')
})

test('defaults limit/offset when omitted', () => {
  const { search } = validateSearchParams({})
  assert.equal(search.get('limit'), '20')
  assert.equal(search.get('offset'), '0')
})

test('rejects an unknown category instead of silently forwarding it upstream', () => {
  assert.deepEqual(validateSearchParams({ category: 'crossfit' }), { error: 'INVALID_CATEGORY' })
})

test('rejects level/force/mechanic outside the documented enums', () => {
  assert.deepEqual(validateSearchParams({ level: 'expert' }), { error: 'INVALID_LEVEL' })
  assert.deepEqual(validateSearchParams({ force: 'twist' }), { error: 'INVALID_FORCE' })
  assert.deepEqual(validateSearchParams({ mechanic: 'hybrid' }), { error: 'INVALID_MECHANIC' })
})

test('clamps limit/offset to our internal caps, stricter than ExerciseAPI own max', () => {
  assert.deepEqual(validateSearchParams({ limit: MAX_LIMIT + 1 }), { error: 'INVALID_LIMIT' })
  assert.deepEqual(validateSearchParams({ limit: 0 }), { error: 'INVALID_LIMIT' })
  assert.deepEqual(validateSearchParams({ offset: MAX_OFFSET + 1 }), { error: 'INVALID_OFFSET' })
  assert.deepEqual(validateSearchParams({ offset: -1 }), { error: 'INVALID_OFFSET' })
  const { search } = validateSearchParams({ limit: MAX_LIMIT, offset: MAX_OFFSET })
  assert.equal(search.get('limit'), String(MAX_LIMIT))
  assert.equal(search.get('offset'), String(MAX_OFFSET))
})

test('rejects a query string outside the 1-200 char bound ExerciseAPI documents', () => {
  assert.deepEqual(validateSearchParams({ q: '' }), { error: 'INVALID_QUERY' })
  assert.deepEqual(validateSearchParams({ q: 'x'.repeat(201) }), { error: 'INVALID_QUERY' })
})

test('rejects free-text muscle/equipment values that do not look like plain names', () => {
  // Path traversal / URL-encoded injection attempts must never reach the upstream fetch.
  assert.deepEqual(validateSearchParams({ muscle: '../../etc/passwd' }), { error: 'INVALID_MUSCLE' })
  assert.deepEqual(validateSearchParams({ equipment: 'a'.repeat(101) }), { error: 'INVALID_EQUIPMENT' })
  assert.equal(validateSearchParams({ muscle: 'lower back' }).error, undefined)
})

test('rejects a non-boolean hasVideo instead of forwarding a truthy-ish string', () => {
  assert.deepEqual(validateSearchParams({ hasVideo: 'true' }), { error: 'INVALID_HAS_VIDEO' })
  assert.equal(validateSearchParams({ hasVideo: true }).search.get('hasVideo'), 'true')
})

test('validateDetailId only accepts the ID shape ExerciseAPI actually uses', () => {
  assert.equal(validateDetailId('Barbell_Bench_Press'), true)
  assert.equal(validateDetailId('../../etc/passwd'), false)
  assert.equal(validateDetailId('a'.repeat(101)), false)
  assert.equal(validateDetailId(123), false)
  assert.equal(validateDetailId(undefined), false)
})

test('parseBudget reads a configured secret over the fallback', () => {
  assert.equal(parseBudget('5000', 8000), 5000)
})

test('parseBudget falls back safely on missing/malformed/non-positive values -- never zero, never NaN', () => {
  assert.equal(parseBudget(undefined, 8000), 8000)
  assert.equal(parseBudget('', 8000), 8000)
  assert.equal(parseBudget('not-a-number', 8000), 8000)
  assert.equal(parseBudget('0', 8000), 8000)
  assert.equal(parseBudget('-100', 8000), 8000)
})

test('mapProviderRateLimitCode distinguishes the two ExerciseAPI 429 reasons', () => {
  assert.equal(mapProviderRateLimitCode('OVERAGE_CAP_EXCEEDED'), 'PROVIDER_OVERAGE_CAP_EXCEEDED')
  assert.equal(mapProviderRateLimitCode('RATE_LIMIT_EXCEEDED'), 'PROVIDER_RATE_LIMITED')
  assert.equal(mapProviderRateLimitCode(undefined), 'PROVIDER_RATE_LIMITED')
})

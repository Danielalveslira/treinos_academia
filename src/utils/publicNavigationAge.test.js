import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publicNavigationAge } from './publicNavigationAge.js'
test('native navigation includes the complete monotonic request age', () => {
  assert.equal(
    publicNavigationAge(
      { now: () => 500, getEntriesByName: () => [{ entryType: 'navigation', startTime: 0 }] },
      'https://example.invalid/locais'
    ),
    500
  )
})
test('Turbo fresh HTML is not aged by an hours-old document clock', () => {
  const perf = {
    now: () => 3600000,
    getEntriesByName: (name) => {
      assert.equal(name, 'https://example.invalid/locais')
      return [{ entryType: 'resource', startTime: 3599750 }]
    },
  }
  assert.equal(publicNavigationAge(perf, 'https://example.invalid/locais#details'), 250)
})
test('unrelated custom performance marks cannot change the navigation deadline', () => {
  assert.equal(
    publicNavigationAge(
      {
        now: () => 1000,
        getEntriesByName: () => [
          { entryType: 'resource', startTime: 400 },
          { entryType: 'mark', startTime: 990 },
        ],
      },
      'https://example.invalid/locais'
    ),
    600
  )
})
test('missing timing falls back conservatively instead of extending a DB lease', () => {
  assert.equal(
    publicNavigationAge(
      { now: () => 1000, getEntriesByName: () => [] },
      'https://example.invalid/locais'
    ),
    1000
  )
})

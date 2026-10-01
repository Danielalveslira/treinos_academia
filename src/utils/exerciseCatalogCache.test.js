import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDetailCacheKey,
  buildSearchCacheKey,
  buildTaxonomyCacheKey,
  dedupeFetch,
  getCacheEntry,
} from './exerciseCatalogCache.js'

// getCacheEntry/setCacheEntry usam o global indexedDB, ausente em node --test -- o
// próprio módulo já degrada pra "sem cache" nesse caso (ver openDb), nunca lança. É
// exatamente essa garantia que este teste prova; o comportamento de fresh/stale/
// stale-while-revalidate em cima de um IndexedDB de verdade é coberto em
// exerciseCatalogService.test.js, com um cache falso injetável.
test('getCacheEntry never throws when IndexedDB is unavailable -- resolves to "no cache" instead', async () => {
  assert.equal(await getCacheEntry('anything'), undefined)
})

test('buildSearchCacheKey normalizes whitespace/case and treats absent filters as empty', () => {
  const a = buildSearchCacheKey({ q: '  Supino Reto  ' })
  const b = buildSearchCacheKey({ q: 'supino reto' })
  assert.equal(a, b)
  const withUndefinedFilters = buildSearchCacheKey({ q: 'supino', category: undefined })
  const withEmptyFilters = buildSearchCacheKey({ q: 'supino', category: '' })
  assert.equal(withUndefinedFilters, withEmptyFilters)
})

test('buildSearchCacheKey produces different keys for different filters, same query', () => {
  const a = buildSearchCacheKey({ q: 'supino', category: 'strength' })
  const b = buildSearchCacheKey({ q: 'supino', category: 'powerlifting' })
  assert.notEqual(a, b)
})

test('buildDetailCacheKey/buildTaxonomyCacheKey are stable and namespaced apart from search', () => {
  assert.equal(buildDetailCacheKey('Bench_Press'), buildDetailCacheKey('Bench_Press'))
  assert.notEqual(buildDetailCacheKey('x'), buildSearchCacheKey({ q: 'x' }))
  assert.notEqual(buildTaxonomyCacheKey('muscles'), buildTaxonomyCacheKey('equipment'))
})

test('dedupeFetch collapses concurrent calls for the same key into a single fetcher invocation', async () => {
  let calls = 0
  const fetcher = () => {
    calls += 1
    return new Promise((resolve) => setTimeout(() => resolve('value'), 10))
  }
  const [a, b] = await Promise.all([dedupeFetch('key-1', fetcher), dedupeFetch('key-1', fetcher)])
  assert.equal(a, 'value')
  assert.equal(b, 'value')
  assert.equal(calls, 1)
})

test('dedupeFetch does not collapse calls for different keys', async () => {
  let calls = 0
  const fetcher = () => {
    calls += 1
    return Promise.resolve('value')
  }
  await Promise.all([dedupeFetch('key-a', fetcher), dedupeFetch('key-b', fetcher)])
  assert.equal(calls, 2)
})

test('dedupeFetch allows a new call once the in-flight one settles', async () => {
  let calls = 0
  const fetcher = () => {
    calls += 1
    return Promise.resolve('value')
  }
  await dedupeFetch('key-c', fetcher)
  await dedupeFetch('key-c', fetcher)
  assert.equal(calls, 2)
})

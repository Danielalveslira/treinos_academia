import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearPageCache,
  fetchCached,
  getCached,
  invalidateWorkoutCache,
  setCached,
} from './pageCache.js'

beforeEach(clearPageCache)

test('simultaneous requests share one fetch, subsequent reads reuse it', async () => {
  let calls = 0
  const read = async () => {
    calls++
    return ['record']
  }
  const [first, second] = await Promise.all([
    fetchCached('workouts:alice:', read),
    fetchCached('workouts:alice:', read),
  ])
  assert.deepEqual(first, second)
  await fetchCached('workouts:alice:', read)
  assert.equal(calls, 1)
  await fetchCached('workouts:alice:', read, { force: true })
  assert.equal(calls, 2)
})

test('failed reads can be retried and never become cached data', async () => {
  await assert.rejects(fetchCached('workouts:alice:', () => Promise.reject(new Error('denied'))))
  assert.equal(getCached('workouts:alice:'), undefined)
  assert.equal(await fetchCached('workouts:alice:', async () => 'allowed'), 'allowed')
})

test('a mutation invalidates all views of that user without touching another account', () => {
  for (const key of [
    'dashboard:alice',
    'workouts:alice:::',
    'exerciseHistory:alice:squat',
    'dashboard:bob',
  ])
    setCached(key, [1])
  invalidateWorkoutCache('alice')
  for (const key of ['dashboard:alice', 'workouts:alice:::', 'exerciseHistory:alice:squat'])
    assert.equal(getCached(key), undefined)
  assert.deepEqual(getCached('dashboard:bob'), [1])
})

test('late responses cannot repopulate cache after logout or overwrite a new request', async () => {
  let finishOld
  const old = fetchCached(
    'dashboard:alice',
    () =>
      new Promise((resolve) => {
        finishOld = resolve
      })
  )
  await Promise.resolve()
  clearPageCache()
  await fetchCached('dashboard:alice', async () => ['new'])
  finishOld(['private old data'])
  await old
  assert.deepEqual(getCached('dashboard:alice'), ['new'])
  clearPageCache()
  assert.equal(getCached('dashboard:alice'), undefined)
})

test('expired entries are fetched again and cache size is bounded', async (t) => {
  t.mock.method(Date, 'now', () => 1000)
  setCached('expires', 1)
  Date.now.mock.mockImplementation(() => 301001)
  assert.equal(getCached('expires'), undefined)
  for (let index = 0; index < 101; index++) setCached(`key:${index}`, index)
  assert.equal(getCached('key:0'), undefined)
  assert.equal(getCached('key:100'), 100)
})

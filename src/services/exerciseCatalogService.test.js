import test from 'node:test'
import assert from 'node:assert/strict'
import { clearExerciseCatalogCache, loadExerciseCatalog } from './exerciseCatalogService.js'

test('catalog service caches a successful HTTP load in memory', async () => {
  clearExerciseCatalogCache()
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return { ok: true, json: async () => ({ version: 1, exercises: [] }) }
  }
  const [first, second] = await Promise.all([loadExerciseCatalog(), loadExerciseCatalog()])
  assert.equal(first, second)
  assert.equal(calls, 1)
})

test('catalog service clears failed loads so retry can succeed', async () => {
  clearExerciseCatalogCache()
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) return { ok: false, status: 503 }
    return { ok: true, json: async () => ({ version: 1, exercises: [] }) }
  }
  await assert.rejects(loadExerciseCatalog(), /503/)
  await assert.doesNotReject(loadExerciseCatalog())
  assert.equal(calls, 2)
})

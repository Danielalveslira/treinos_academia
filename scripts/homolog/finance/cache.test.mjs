import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMAGES, verifiedTag } from './images.mjs'
import { restoreCache, saveCache } from './cache.mjs'

const keys = Object.keys(IMAGES)
const registry = 'ghcr.io/supabase/'
const repoDigest = key => {
  const [name, digest] = IMAGES[key].split('@')
  return registry + name.split(':')[0] + '@' + digest
}
function fixture(loaded = keys) {
  const available = new Set(loaded)
  const calls = []
  const run = (...args) => {
    calls.push(args)
    if (args[0] === 'load') return 'Loaded image(s)'
    if (args[0] === 'image' && args[1] === 'inspect') {
      const key = keys.find(item => verifiedTag(item) === args[2])
      if (!available.has(key)) throw new Error('No such image')
      return JSON.stringify([{
        Id: 'sha256:' + 'a'.repeat(64), Os: 'linux', Architecture: 'amd64', RepoDigests: [repoDigest(key)],
      }])
    }
    return ''
  }
  return { available, calls, run }
}

test('complete OCI cache avoids registry downloads', async () => {
  const state = fixture()
  const records = []
  await restoreCache({ run: state.run, acquire: () => { throw new Error('unexpected pull') }, record: line => records.push(line), log: () => {} })
  assert.deepEqual(records, ['FINANCE_OCI_CACHE_LOADED=1\n'])
  assert.equal(state.calls.filter(([command]) => command === 'load').length, 1)
})

test('incomplete cache pulls only missing pinned images and marks cache verified after recovery', async () => {
  const state = fixture(keys.slice(1))
  const acquired = []
  const records = []
  await restoreCache({
    run: state.run,
    acquire: async key => { acquired.push(key); state.available.add(key); return verifiedTag(key) },
    record: line => records.push(line), log: () => {},
  })
  assert.deepEqual(acquired, [keys[0]])
  assert.deepEqual(records, ['FINANCE_OCI_CACHE_LOADED=1\n'])
})

test('unreadable archive recovers only from pinned images', async () => {
  const state = fixture([])
  const acquired = []
  const run = (...args) => {
    if (args[0] === 'load') throw new Error('invalid tar')
    return state.run(...args)
  }
  await restoreCache({
    run,
    acquire: async key => { acquired.push(key); state.available.add(key); return verifiedTag(key) },
    record: () => {}, log: () => {},
  })
  assert.deepEqual(acquired, keys)
})

test('recovery rejects a tag that does not match the key it was acquired for, without trusting an incomplete cache', async () => {
  const state = fixture(keys.slice(1))
  const records = []
  await assert.rejects(
    restoreCache({ run: state.run, acquire: async () => verifiedTag(keys[1]), record: line => records.push(line), log: () => {} }),
    /IMAGE_INTEGRITY_FAILED/
  )
  assert.deepEqual(records, [])
})

test('save uses verified named references so docker load restores the same tags', async () => {
  const state = fixture()
  await saveCache({ run: state.run, acquire: async key => { state.available.add(key); return verifiedTag(key) }, log: () => {} })
  const saved = state.calls.find(([command]) => command === 'save')
  assert.equal(saved.length, keys.length + 3)
  assert.deepEqual(saved.slice(3), keys.map(verifiedTag))
})

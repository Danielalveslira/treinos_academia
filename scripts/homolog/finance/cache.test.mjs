import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMAGES, VERIFIED_AMD64_IDS } from './images.mjs'
import { restoreCache, saveCache } from './cache.mjs'

const keys = Object.keys(IMAGES)
function fixture(loaded = keys) {
  const available = new Set(loaded)
  const calls = []
  const run = (...args) => {
    calls.push(args)
    if (args[0] === 'load') return 'Loaded image(s)'
    if (args[0] === 'image' && args[1] === 'inspect') {
      const key = keys.find(item => VERIFIED_AMD64_IDS[item] === args[2])
      if (!available.has(key)) throw new Error('No such image')
      return JSON.stringify([{ Id: args[2], Os: 'linux', Architecture: 'amd64' }])
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
    acquire: async key => { acquired.push(key); state.available.add(key); return VERIFIED_AMD64_IDS[key] },
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
    acquire: async key => { acquired.push(key); state.available.add(key); return VERIFIED_AMD64_IDS[key] },
    record: () => {}, log: () => {},
  })
  assert.deepEqual(acquired, keys)
})

test('recovery rejects wrong config ID without trusting an incomplete cache', async () => {
  const state = fixture(keys.slice(1))
  const records = []
  await assert.rejects(
    restoreCache({ run: state.run, acquire: async () => VERIFIED_AMD64_IDS[keys[1]], record: line => records.push(line), log: () => {} }),
    /IMAGE_INTEGRITY_FAILED/
  )
  assert.deepEqual(records, [])
})

test('save uses verified named references so docker load restores the IDs', async () => {
  const state = fixture()
  await saveCache({ run: state.run, acquire: async key => VERIFIED_AMD64_IDS[key], log: () => {} })
  const saved = state.calls.find(([command]) => command === 'save')
  assert.equal(saved.length, keys.length + 3)
  assert.ok(saved.slice(3).every(tag => tag.startsWith('finance-verified/')))
})

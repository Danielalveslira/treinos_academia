import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearPhotoCache,
  getCachedPhotoUrl,
  invalidatePhotoPath,
  loadPhotoOnce,
  setCachedPhotoUrl,
  subscribePhotoCache,
} from './photoBlobCache.js'

test('invalidação do avatar antigo preserva outras fotos e descarta download tardio', async () => {
  clearPhotoCache()
  setCachedPhotoUrl('other.webp', 'blob:other')
  let resolveOld
  const pending = loadPhotoOnce(
    'old.webp',
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      })
  )
  await Promise.resolve()
  invalidatePhotoPath('old.webp')
  resolveOld('blob:old')
  assert.equal(await pending, '')
  assert.equal(getCachedPhotoUrl('old.webp'), undefined)
  assert.equal(getCachedPhotoUrl('other.webp'), 'blob:other')
})

test('substituição no mesmo caminho avisa os cards e invalida download antigo', async () => {
  clearPhotoCache()
  const events = []
  const unsubscribe = subscribePhotoCache((path) => events.push(path))
  let resolveOld
  const old = loadPhotoOnce(
    'covers/c.webp',
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      })
  )
  await Promise.resolve()
  setCachedPhotoUrl('covers/c.webp', 'blob:new')
  resolveOld('blob:old')
  assert.equal(await old, 'blob:new')
  assert.equal(getCachedPhotoUrl('covers/c.webp'), 'blob:new')
  assert.deepEqual(events, ['covers/c.webp'])
  unsubscribe()
})

test('two concurrent loads of the same path share a single fetch and see the same URL', async () => {
  clearPhotoCache()
  let calls = 0
  const fetcher = () => {
    calls += 1
    return Promise.resolve(`blob:shared-${calls}`)
  }
  const [first, second] = await Promise.all([
    loadPhotoOnce('avatars/a.webp', fetcher),
    loadPhotoOnce('avatars/a.webp', fetcher),
  ])
  assert.equal(calls, 1, 'the underlying fetch runs exactly once for concurrent callers')
  assert.equal(first, 'blob:shared-1')
  assert.equal(second, 'blob:shared-1')
  assert.equal(getCachedPhotoUrl('avatars/a.webp'), 'blob:shared-1')
})

test('a resolved path is served from cache on a later call, without fetching again', async () => {
  clearPhotoCache()
  let calls = 0
  const fetcher = () => {
    calls += 1
    return Promise.resolve('blob:once')
  }
  await loadPhotoOnce('avatars/b.webp', fetcher)
  const again = await loadPhotoOnce('avatars/b.webp', fetcher)
  assert.equal(calls, 1)
  assert.equal(again, 'blob:once')
})

test('different paths are fetched independently, never blocked by one another', async () => {
  clearPhotoCache()
  const calls = []
  const fetcher = (path) => {
    calls.push(path)
    return Promise.resolve(`blob:${path}`)
  }
  const [a, b] = await Promise.all([
    loadPhotoOnce('avatars/c.webp', () => fetcher('avatars/c.webp')),
    loadPhotoOnce('avatars/d.webp', () => fetcher('avatars/d.webp')),
  ])
  assert.deepEqual(calls.sort(), ['avatars/c.webp', 'avatars/d.webp'])
  assert.equal(a, 'blob:avatars/c.webp')
  assert.equal(b, 'blob:avatars/d.webp')
})

test('a failed fetch is never cached and a later call retries instead of repeating the rejection', async () => {
  clearPhotoCache()
  let calls = 0
  const fetcher = () => {
    calls += 1
    return calls === 1
      ? Promise.reject(new Error('network down'))
      : Promise.resolve('blob:recovered')
  }
  await assert.rejects(loadPhotoOnce('avatars/e.webp', fetcher), /network down/)
  assert.equal(getCachedPhotoUrl('avatars/e.webp'), undefined)
  const recovered = await loadPhotoOnce('avatars/e.webp', fetcher)
  assert.equal(recovered, 'blob:recovered')
  assert.equal(calls, 2)
})

test('a caller arriving after an in-flight fetch already failed does not join a dead promise', async () => {
  clearPhotoCache()
  let resolveFirst
  let calls = 0
  const fetcher = () => {
    calls += 1
    if (calls === 1) return new Promise((resolve, reject) => (resolveFirst = reject))
    return Promise.resolve('blob:second-wave')
  }
  const firstCall = loadPhotoOnce('avatars/f.webp', fetcher)
  await Promise.resolve() // deixa o fetcher (agendado num microtask) rodar e atribuir resolveFirst
  resolveFirst(new Error('boom'))
  await assert.rejects(firstCall, /boom/)
  const secondCall = await loadPhotoOnce('avatars/f.webp', fetcher)
  assert.equal(secondCall, 'blob:second-wave')
  assert.equal(calls, 2)
})

test('setCachedPhotoUrl short-circuits loadPhotoOnce even when nothing is in flight', async () => {
  clearPhotoCache()
  setCachedPhotoUrl('avatars/g.webp', 'blob:preset')
  let calls = 0
  const result = await loadPhotoOnce('avatars/g.webp', () => {
    calls += 1
    return Promise.resolve('blob:should-not-run')
  })
  assert.equal(result, 'blob:preset')
  assert.equal(calls, 0)
})

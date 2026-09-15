import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let exerciseCachedQuery
let exerciseSponsoredAds

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sponsored-ads-tests-'))
  const cachedQueryOutfile = join(directory, 'cached-query.cjs')
  const sponsoredAdsOutfile = join(directory, 'sponsored-ads.cjs')

  await build({
    stdin: {
      contents: `
        import { useCachedQuery } from './useCachedQuery.js'
        import { resetHooks, runEffects, getUpdates } from 'react'

        const flush = async () => {
          await Promise.resolve()
          await Promise.resolve()
        }

        export async function exerciseCachedQuery(mode) {
          resetHooks()
          let calls = 0
          let finish
          const fetchValue = () => {
            calls += 1
            return mode === 'late'
              ? new Promise((resolve) => { finish = resolve })
              : Promise.resolve(['current'])
          }
          const result = useCachedQuery('sponsoredAds:test', fetchValue, {
            enabled: mode !== 'disabled',
            context: 'test',
          })
          const cleanup = await runEffects()
          if (mode === 'disabled') await result.refresh()
          if (mode === 'late') {
            cleanup()
            finish(['obsolete'])
            await flush()
          } else {
            cleanup()
          }
          return { calls, result, updates: getUpdates() }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile: cachedQueryOutfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'cached-query-test-stubs',
        setup(buildContext) {
          buildContext.onResolve({ filter: /^react$/ }, () => ({
            path: 'react',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /utils\/pageCache$/ }, () => ({
            path: 'page-cache',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /utils\/firestoreError$/ }, () => ({
            path: 'firestore-error',
            namespace: 'stub',
          }))
          buildContext.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
            contents: `
              let effects = []
              let updates = []
              export const useCallback = (fn) => fn
              export const useRef = (value) => ({ current: value })
              export const useState = (initial) => {
                let current = typeof initial === 'function' ? initial() : initial
                return [current, (value) => {
                  current = typeof value === 'function' ? value(current) : value
                  updates.push(current)
                }]
              }
              export const useEffect = (effect) => effects.push(effect)
              export const getUpdates = () => updates
              export const resetHooks = () => { effects = []; updates = [] }
              export async function runEffects() {
                const cleanups = effects.splice(0).map((effect) => effect()).filter(Boolean)
                await Promise.resolve()
                await Promise.resolve()
                return () => cleanups.forEach((cleanup) => cleanup())
              }
            `,
          }))
          buildContext.onLoad({ filter: /^page-cache$/, namespace: 'stub' }, () => ({
            contents: `
              export const getCached = () => undefined
              export const setCached = () => {}
              export const invalidateCache = () => {}
              export const fetchCached = (_key, fetchValue) => fetchValue()
            `,
          }))
          buildContext.onLoad({ filter: /^firestore-error$/, namespace: 'stub' }, () => ({
            contents: `export const describeFirestoreError = () => ({ message: 'erro' })`,
          }))
        },
      },
    ],
  })

  await build({
    stdin: {
      contents: `
        import { useSponsoredAds } from './useSponsoredAds.js'
        import { useGlobalSponsoredAds } from './useGlobalSponsoredAds.js'
        import { getCalls, resetCalls } from '../services/sponsoredAdsService'

        export function exerciseSponsoredAds() {
          resetCalls()
          const disabled = useSponsoredAds('community-1', false)
          const disabledCalls = getCalls()
          const community = useSponsoredAds('community-1', true)
          const global = useGlobalSponsoredAds(true)
          return { disabled, disabledCalls, community, global, calls: getCalls() }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile: sponsoredAdsOutfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'sponsored-ads-test-stubs',
        setup(buildContext) {
          buildContext.onResolve({ filter: /^react$/ }, () => ({
            path: 'react',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /services\/sponsoredAdsService$/ }, () => ({
            path: 'sponsored-ads-service',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /useCachedQuery$/ }, () => ({
            path: 'cached-query',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /utils\/expiry$/ }, () => ({
            path: 'expiry',
            namespace: 'stub',
          }))
          buildContext.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
            contents: `export const useCallback = (fn) => fn`,
          }))
          buildContext.onLoad({ filter: /^sponsored-ads-service$/, namespace: 'stub' }, () => ({
            contents: `
              let calls = 0
              export const listSponsoredAdsForCommunity = () => { calls += 1; return [] }
              export const listGlobalSponsoredAds = () => { calls += 1; return [] }
              export const getCalls = () => calls
              export const resetCalls = () => { calls = 0 }
            `,
          }))
          buildContext.onLoad({ filter: /^cached-query$/, namespace: 'stub' }, () => ({
            contents: `
              const ads = [
                { id: 'feed', expiresAt: null, displayMode: ['feed'] },
                { id: 'banner', expiresAt: 200, displayMode: ['banner'] },
                { id: 'expired', expiresAt: 50, displayMode: ['feed', 'banner'] },
              ]
              export function useCachedQuery(_key, fetchValue, options) {
                if (!options.enabled) return { data: undefined, loading: false, error: null }
                fetchValue()
                return { data: ads, loading: false, error: null }
              }
            `,
          }))
          buildContext.onLoad({ filter: /^expiry$/, namespace: 'stub' }, () => ({
            contents: `export const toMillis = (value) => value`,
          }))
        },
      },
    ],
  })

  ;({ exerciseCachedQuery } = createRequire(import.meta.url)(cachedQueryOutfile))
  ;({ exerciseSponsoredAds } = createRequire(import.meta.url)(sponsoredAdsOutfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('disabled cached query stays idle, including explicit refresh', async () => {
  const { calls, result } = await exerciseCachedQuery('disabled')
  assert.equal(calls, 0)
  assert.equal(result.loading, false)
  assert.equal(result.error, null)
  assert.equal(result.data, undefined)
})

test('cached query ignores a response completed after effect cleanup', async () => {
  const { calls, updates } = await exerciseCachedQuery('late')
  assert.equal(calls, 1)
  assert.equal(
    updates.some((state) => state?.data?.[0] === 'obsolete'),
    false
  )
})

test('sponsored ad hooks honor enabled and retain mode and expiry filters', (t) => {
  t.mock.method(Date, 'now', () => 100)
  const { disabled, disabledCalls, community, global, calls } = exerciseSponsoredAds()
  assert.equal(disabledCalls, 0)
  assert.deepEqual(disabled.feedAds, [])
  assert.deepEqual(disabled.bannerAds, [])
  assert.equal(calls, 2)
  assert.deepEqual(
    community.feedAds.map((ad) => ad.id),
    ['feed']
  )
  assert.deepEqual(
    community.bannerAds.map((ad) => ad.id),
    ['banner']
  )
  assert.deepEqual(
    global.bannerAds.map((ad) => ad.id),
    ['banner']
  )
})

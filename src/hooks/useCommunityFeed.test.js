import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let exercise

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-feed-tests-'))
  const outfile = join(directory, 'feed.cjs')
  await build({
    stdin: {
      contents: `
        import { useCommunityFeed } from './useCommunityFeed.js'
        import { runEffects } from 'react'
        import { getFeedCalls, resetFeedCalls } from '../services/statusesService'

        export async function exercise(enabled) {
          resetFeedCalls()
          let intervals = 0
          let clearedIntervals = 0
          const originalSetInterval = globalThis.setInterval
          const originalClearInterval = globalThis.clearInterval
          globalThis.setInterval = () => { intervals += 1; return intervals }
          globalThis.clearInterval = () => { clearedIntervals += 1 }
          try {
            const result = useCommunityFeed('community-1', enabled)
            const cleanup = await runEffects()
            const automaticCalls = getFeedCalls()
            await result.refresh()
            cleanup()
            return {
              automaticCalls,
              totalCalls: getFeedCalls(),
              intervals,
              clearedIntervals,
              initialLoading: result.loading,
              initialStatuses: result.statuses,
              initialError: result.error,
            }
          } finally {
            globalThis.setInterval = originalSetInterval
            globalThis.clearInterval = originalClearInterval
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'community-feed-test-stubs',
        setup(buildContext) {
          buildContext.onResolve({ filter: /^react$/ }, () => ({
            path: 'react',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /services\/statusesService$/ }, () => ({
            path: 'statuses',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /utils\/firestoreError$/ }, () => ({
            path: 'firestore-error',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /utils\/expiry$/ }, () => ({
            path: 'expiry',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /utils\/pageCache$/ }, () => ({
            path: 'page-cache',
            namespace: 'stub',
          }))
          buildContext.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
            contents: `
              let effects = []
              export const useCallback = (fn) => fn
              export const useRef = (value) => ({ current: value })
              export const useState = (initial) => [
                typeof initial === 'function' ? initial() : initial,
                () => {},
              ]
              export const useEffect = (effect) => effects.push(effect)
              export async function runEffects() {
                const current = effects
                effects = []
                const cleanups = current.map((effect) => effect()).filter(Boolean)
                await Promise.resolve()
                await Promise.resolve()
                return () => cleanups.forEach((cleanup) => cleanup())
              }
            `,
          }))
          buildContext.onLoad({ filter: /^statuses$/, namespace: 'stub' }, () => ({
            contents: `
              let calls = 0
              export const listCommunityFeed = async () => { calls += 1; return [] }
              export const deleteStatus = async () => {}
              export const getFeedCalls = () => calls
              export const resetFeedCalls = () => { calls = 0 }
            `,
          }))
          buildContext.onLoad({ filter: /^firestore-error$/, namespace: 'stub' }, () => ({
            contents: `export const describeFirestoreError = () => 'erro'`,
          }))
          buildContext.onLoad({ filter: /^expiry$/, namespace: 'stub' }, () => ({
            contents: `export const toMillis = () => 1`,
          }))
          buildContext.onLoad({ filter: /^page-cache$/, namespace: 'stub' }, () => ({
            contents: `
              export const getCached = () => undefined
              export const setCached = () => {}
              export const fetchCached = async (_key, fetchValue) => fetchValue()
            `,
          }))
        },
      },
    ],
  })
  ;({ exercise } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('disabled feed performs no automatic or manual query and starts no timer', async () => {
  const result = await exercise(false)
  assert.equal(result.automaticCalls, 0)
  assert.equal(result.totalCalls, 0)
  assert.equal(result.intervals, 0)
  assert.equal(result.initialLoading, false)
  assert.deepEqual(result.initialStatuses, [])
  assert.equal(result.initialError, null)
})

test('enabled feed loads once, refreshes explicitly and cleans its shared timer', async () => {
  const result = await exercise(true)
  assert.equal(result.automaticCalls, 1)
  assert.equal(result.totalCalls, 2)
  assert.equal(result.intervals, 1)
  assert.equal(result.clearedIntervals, 1)
  assert.equal(result.initialLoading, true)
})

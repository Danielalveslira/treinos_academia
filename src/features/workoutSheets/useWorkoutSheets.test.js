import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { build, stop } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
let api, directory
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sheet-review-hook-'))
  const outfile = join(directory, 'hook.cjs')
  await build({
    stdin: {
      contents: `
      import React from 'react';import TestRenderer,{act} from 'react-test-renderer';
      import {useWorkoutSheets} from './useWorkoutSheets.js';
      let latest;export {act};
      function Probe({uid,id,exercise}){globalThis.__sheetReview.uid=uid;latest=useWorkoutSheets(id,id?true:'picker',false,0,exercise);return null}
      export const mount=(props)=>TestRenderer.create(React.createElement(Probe,props));
      export const change=(root,props)=>root.update(React.createElement(Probe,props));
      export const state=()=>latest;
    `,
      resolveDir: import.meta.dirname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'boundaries',
        setup(b) {
          b.onResolve(
            { filter: /^(react(?:\/jsx-runtime)?|react-test-renderer)$/ },
            ({ path }) => ({ path: require.resolve(path), external: true })
          )
          const stubs = {
            '/hooks/useAuth': `export const useAuth=()=>({user:{uid:globalThis.__sheetReview.uid},offlineLocal:false})`,
            '/hooks/useOnlineStatus': `export const useOnlineStatus=()=>globalThis.__sheetReview.online`,
            '/services/offline/sheetSnapshot.js': `export const readSheetSnapshots=async()=>globalThis.__sheetReview.snapshots;export const saveSheetSnapshot=async()=>true;export const invalidateSheetSnapshots=async(...args)=>globalThis.__sheetReview.invalidations.push(args)`,
            './workoutSheetsService.js': `export const getWorkoutSheet=(id)=>globalThis.__sheetReview.read(id);export const getSheetInsightsForExercise=(id)=>{globalThis.__sheetReview.aggregateCalls.push(id);return globalThis.__sheetReview.aggregate(id)};export const listWorkoutSheets=async()=>[]`,
            '/services/workoutsService.js': `export const getSheetInsights=async()=>({sheets:[]})`,
            '/utils/pageCache.js': `export const fetchCached=(key,read)=>read()`,
          }
          b.onResolve({ filter: /.*/ }, ({ path }) => {
            const key = Object.keys(stubs).find((k) => path.endsWith(k))
            return key ? { path: key, namespace: 'stub' } : undefined
          })
          b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: stubs[path] }))
        },
      },
    ],
  })
  api = createRequire(import.meta.url)(outfile)
})
after(async () => {
  delete globalThis.__sheetReview
  stop()
  await rm(directory, { recursive: true, force: true })
})
const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve()
}
const fixture = () =>
  (globalThis.__sheetReview = {
    uid: 'a',
    online: true,
    invalidations: [],
    aggregateCalls: [],
    snapshots: [],
    aggregate: async () => ({ sheets: [{ id: 'matching' }] }),
    read: async () => {
      throw new Error('Failed to fetch')
    },
  })
test('temporary network, gateway, refresh and unknown errors never invalidate snapshots', async () => {
  for (const error of [
    new TypeError('Failed to fetch'),
    { status: 503, message: 'Gateway timeout' },
    { code: 'PGRST301', message: 'JWT expired' },
    new Error('unexpected'),
  ]) {
    const f = fixture()
    f.read = async () => {
      throw error
    }
    let root
    await api.act(async () => {
      root = api.mount({ uid: 'a', id: 'sheet-1' })
      await flush()
    })
    assert.deepEqual(f.invalidations, [])
    assert.equal(api.state().error, error)
    api.act(() => root.unmount())
  }
})
test('proven sheet refusal invalidates only its owner and ID; revocation clears only that owner', async () => {
  for (const [message, scope] of [
    ['SHEET_NOT_READY', 'sheet-1'],
    ['SHEET_NOT_FOUND', 'sheet-1'],
    ['SESSION_REVOKED', null],
    ['APP_ACCESS_DENIED', null],
  ]) {
    const f = fixture()
    f.read = async () => {
      throw new Error(message)
    }
    let root
    await api.act(async () => {
      root = api.mount({ uid: 'a', id: 'sheet-1' })
      await flush()
    })
    assert.deepEqual(f.invalidations, [['a', scope]])
    api.act(() => root.unmount())
  }
})
test('old account refusal cannot invalidate data after switching users', async () => {
  const f = fixture()
  let reject, root
  f.read = () =>
    new Promise((_, r) => {
      reject = r
    })
  await api.act(async () => {
    root = api.mount({ uid: 'a', id: 'sheet-1' })
    await flush()
  })
  const oldReject = reject
  f.read = async () => ({ id: 'sheet-2' })
  await api.act(async () => {
    api.change(root, { uid: 'b', id: 'sheet-2' })
    await flush()
    oldReject(new Error('SESSION_REVOKED'))
    await flush()
  })
  assert.deepEqual(f.invalidations, [])
  assert.equal(api.state().data.id, 'sheet-2')
  api.act(() => root.unmount())
})
test('exercise intent makes one aggregate request and no per-sheet reads', async () => {
  const f = fixture()
  f.read = () => {
    throw new Error('N+1 forbidden')
  }
  let root
  await api.act(async () => {
    root = api.mount({ uid: 'a', exercise: 'exercise-1' })
    await flush()
  })
  assert.deepEqual(f.aggregateCalls, ['exercise-1'])
  assert.deepEqual(api.state().data, [{ id: 'matching' }])
  api.act(() => root.unmount())
})
test('offline exercise filtering uses only previously validated snapshots', async () => {
  const f = fixture()
  f.online = false
  f.snapshots = [
    { id: 'yes', items: [{ exercise_id: 'exercise-1', available: true, exercise: { typeMismatch: false } }] },
    { id: 'no', items: [{ exercise_id: 'other', available: true, exercise: { typeMismatch: false } }] },
  ]
  let root
  await api.act(async () => {
    root = api.mount({ uid: 'a', exercise: 'exercise-1' })
    await flush()
  })
  assert.deepEqual(f.aggregateCalls, [])
  assert.deepEqual(
    api.state().data.map((s) => s.id),
    ['yes']
  )
  api.act(() => root.unmount())
})

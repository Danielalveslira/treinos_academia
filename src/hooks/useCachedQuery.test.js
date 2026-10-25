import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
let api, directory
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'home-cache-'))
  const outfile = join(directory, 'test.cjs')
  await build({
    stdin: {
      contents: `
    import React from 'react'; import TestRenderer, {act} from 'react-test-renderer';
    import {useCachedQuery} from './useCachedQuery.js';
    export {invalidateWorkoutCache,clearPageCache} from '../utils/pageCache.js';
    export {act}; let latest; let calls=0;
    const read=async()=>++calls;
    function Probe({uid}) {latest=useCachedQuery('home-sheet-activity:'+uid+':day',read,{observeInvalidation:true,keepPreviousScope:uid});return null}
    export const mount=(uid)=>TestRenderer.create(React.createElement(Probe,{uid}));
    export const change=(r,uid)=>r.update(React.createElement(Probe,{uid}));
    export const state=()=>latest; export const count=()=>calls;
  `,
      resolveDir: import.meta.dirname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  api = createRequire(import.meta.url)(outfile)
})
after(() => rm(directory, { recursive: true, force: true }))
test('mounted Home refetches once per batch; other users stay isolated; account change clears previous data', async () => {
  let root
  api.act(() => {
    root = api.mount('alice')
  })
  await flush()
  assert.equal(api.state().data, 1)
  api.act(() => {
    api.invalidateWorkoutCache('bob')
  })
  await flush()
  assert.equal(api.count(), 1)
  api.act(() => {
    api.invalidateWorkoutCache('alice')
    api.invalidateWorkoutCache('alice')
  })
  await flush()
  assert.equal(api.count(), 2)
  assert.equal(api.state().data, 2)
  api.act(() => {
    api.change(root, 'bob')
  })
  assert.equal(api.state().data, undefined)
  await flush()
  assert.equal(api.state().data, 3)
  api.act(() => root.unmount())
  api.invalidateWorkoutCache('bob')
  await Promise.resolve()
  assert.equal(api.count(), 3)
})

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
let directory, lib
const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'advertiser-page-tests-'))
  const outfile = join(directory, 'hook.cjs')
  await build({
    stdin: {
      contents: `
 import React from 'react';import Renderer,{act} from 'react-test-renderer';import{useAdvertiserPage}from'./useAdvertiserPage.js';
 export function mount(props){let current;function Harness(p){current=useAdvertiserPage('admin_advertiser_directory',p.args,p.enabled);return null}let renderer;act(()=>{renderer=Renderer.create(React.createElement(Harness,props))});return {state:()=>current,update:p=>act(()=>renderer.update(React.createElement(Harness,p))),more:()=>act(()=>{current.more();current.more()}),refresh:()=>act(()=>{current.refresh()}),unmount:()=>{act(()=>renderer.unmount())}}}
 `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'rpc-fixture',
        setup(b) {
          b.onResolve({ filter: /advertisers\.api$/ }, () => ({
            path: 'rpc',
            namespace: 'fixture',
          }))
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              'export const advertiserRpc=(name,args)=>globalThis.__advertiserPageRpc(name,args)',
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  lib = createRequire(import.meta.url)(outfile)
})
after(async () => {
  delete globalThis.__advertiserPageRpc
  if (directory) await rm(directory, { recursive: true, force: true })
})
test('loads one bounded page; more is incremental and duplicate clicks do not duplicate requests', async (t) => {
  const calls = []
  globalThis.__advertiserPageRpc = async (_, args) => {
    calls.push(args)
    return args.p_offset
      ? [{ id: 'last' }]
      : Array.from({ length: 100 }, (_, i) => ({ id: String(i) }))
  }
  const view = lib.mount({ args: { p_kind: 'campaigns', p_account_id: 'A' }, enabled: true })
  t.after(view.unmount)
  await tick()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].p_offset, 0)
  assert.equal(view.state().rows.length, 100)
  assert.equal(view.state().hasMore, true)
  view.more()
  await tick()
  assert.equal(calls.length, 2)
  assert.equal(calls[1].p_offset, 100)
  assert.equal(view.state().rows.length, 101)
  assert.equal(view.state().hasMore, false)
})
test('account switch clears previous rows and ignores a delayed response from the old account', async (t) => {
  let release
  globalThis.__advertiserPageRpc = async (_, args) =>
    args.p_account_id === 'A'
      ? new Promise((r) => {
          release = r
        })
      : [{ id: 'B-only' }]
  const view = lib.mount({ args: { p_account_id: 'A' }, enabled: true })
  t.after(view.unmount)
  await tick()
  view.update({ args: { p_account_id: 'B' }, enabled: true })
  assert.deepEqual(view.state().rows, [])
  await tick()
  assert.deepEqual(view.state().rows, [{ id: 'B-only' }])
  release([{ id: 'A-only' }])
  await tick()
  assert.deepEqual(view.state().rows, [{ id: 'B-only' }])
})
test('disabled picker does not fetch; invalidating a search hides old results immediately', async (t) => {
  const calls = []
  globalThis.__advertiserPageRpc = async (_, args) => {
    calls.push(args)
    return [{ id: 'reader' }]
  }
  const view = lib.mount({ args: { p_kind: 'users', p_search: '' }, enabled: false })
  t.after(view.unmount)
  await tick()
  assert.equal(calls.length, 0)
  view.update({ args: { p_kind: 'users', p_search: 'reader' }, enabled: true })
  await tick()
  assert.equal(view.state().rows.length, 1)
  view.update({ args: { p_kind: 'users', p_search: '' }, enabled: false })
  assert.equal(view.state().rows.length, 0)
  await tick()
  assert.equal(calls.length, 1)
})
test('authorization failure on refresh removes all previously loaded rows', async (t) => {
  let denied = false
  globalThis.__advertiserPageRpc = async () => {
    if (denied) throw Object.assign(new Error('PERMISSION_DENIED'), { code: '42501' })
    return [{ id: 'secret' }]
  }
  const view = lib.mount({ args: { p_account_id: 'A' }, enabled: true })
  t.after(view.unmount)
  await tick()
  assert.equal(view.state().rows.length, 1)
  denied = true
  view.refresh()
  await tick()
  assert.equal(view.state().status, 'error')
  assert.deepEqual(view.state().rows, [])
  assert.equal(view.state().error.code, '42501')
})
test('a previous session response cannot populate a newly mounted account', async (t) => {
  let release
  globalThis.__advertiserPageRpc = async () =>
    new Promise((r) => {
      release = r
    })
  const previous = lib.mount({ args: { p_account_id: 'A' }, enabled: true })
  await tick()
  previous.unmount()
  globalThis.__advertiserPageRpc = async () => [{ id: 'current-session' }]
  const current = lib.mount({ args: { p_account_id: 'A' }, enabled: true })
  t.after(current.unmount)
  await tick()
  release([{ id: 'previous-session' }])
  await tick()
  assert.deepEqual(current.state().rows, [{ id: 'current-session' }])
})
test('malformed catalog response becomes a recoverable error', async (t) => {
  globalThis.__advertiserPageRpc = async () => ({ unexpected: true })
  const view = lib.mount({ args: {}, enabled: true })
  t.after(view.unmount)
  await tick()
  assert.equal(view.state().status, 'error')
  assert.deepEqual(view.state().rows, [])
})

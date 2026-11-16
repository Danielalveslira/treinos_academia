import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import process from 'node:process'
import { build } from 'esbuild'

let directory
let api
const require = createRequire(import.meta.url)

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cash-purchases-hook-'))
  const outfile = join(directory, 'hook.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { useCashPurchases } from './useCashPurchases.js'
        let latest
        function Probe({ userId }) { latest = useCashPurchases(userId); return null }
        export const current = () => latest
        export const mount = (userId) => {
          let renderer
          act(() => { renderer = TestRenderer.create(React.createElement(Probe, { userId })) })
          return {
            update: (next) => act(() => renderer.update(React.createElement(Probe, { userId: next }))),
            unmount: () => act(() => renderer.unmount()),
          }
        }
        export { act }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'cash-stubs',
        setup(b) {
          b.onResolve({ filter: /\/supabase\/config$/ }, () => ({
            path: 'supabase',
            namespace: 'stub',
          }))
          b.onResolve({ filter: /\/services\/cashPurchaseService$/ }, () => ({
            path: 'service',
            namespace: 'stub',
          }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            contents:
              args.path === 'supabase'
                ? `export const supabase = { channel(name) { const channel = { on(_event, _filter, callback) { globalThis.__listeners.set(name, callback); return this }, subscribe() { return this }, unsubscribe() { globalThis.__listeners.delete(name) } }; return channel } }`
                : `export const listMyCashPurchasesPage = (...args) => globalThis.__page(...args); export const getMyPendingCashPurchase = (...args) => globalThis.__pending(...args); export const mapPurchaseRow = (row) => row; export const listCashPurchasesForAdminPage = async () => ({ items: [], nextCursor: null });`,
            loader: 'js',
          }))
        },
      },
    ],
  })
  api = require(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  for (const handle of process._getActiveHandles()) {
    if (handle.constructor.name === 'MessagePort') handle.unref()
  }
})

const row = (id, day, status = 'credited') => ({
  id,
  userId: 'user-1',
  createdAt: `2026-11-${String(day).padStart(2, '0')}T12:00:00Z`,
  status,
  paymentProvider: 'infinitepay',
  checkoutUrl: status === 'pending' ? null : 'https://checkout.infinitepay.io/test',
})
const pending = row('older-pending', 1, 'pending')
const firstPage = Array.from({ length: 25 }, (_, index) => row(`recent-${index}`, 30 - index))
const settle = () => api.act(async () => new Promise((resolve) => setTimeout(resolve, 5)))

function setup({ page, pendingPurchase } = {}) {
  globalThis.__listeners = new Map()
  globalThis.__page =
    page ||
    (async (_userId, options) =>
      options?.cursor
        ? { items: [row('older-pending', 1)], nextCursor: null }
        : { items: firstPage, nextCursor: 'cursor-1' })
  globalThis.__pending = pendingPurchase || (async () => pending)
  return api.mount('user-1')
}

test('pending outside page survives Realtime credit, refresh and pagination without duplicates', async () => {
  let backendPending = pending
  const tree = setup({ pendingPurchase: async () => backendPending })
  await settle()
  assert.equal(api.current().pendingPurchase.id, pending.id)
  assert.equal(api.current().purchases.length, 25)
  const listener = globalThis.__listeners.get(`cash-purchase-${pending.id}`)
  assert.ok(listener)
  backendPending = null
  api.act(() => listener({ new: { ...pending, status: 'credited' } }))
  assert.equal(api.current().pendingPurchase, null)
  assert.equal(api.current().lastRealtimeCredit.purchaseId, pending.id)
  assert.equal(
    api.current().purchases.find((purchase) => purchase.id === pending.id).status,
    'credited'
  )
  await api.act(async () => api.current().refresh())
  assert.equal(api.current().purchases.filter((purchase) => purchase.id === pending.id).length, 1)
  await api.act(async () => api.current().loadMore())
  const rows = api.current().purchases
  assert.equal(rows.filter((purchase) => purchase.id === pending.id).length, 1)
  assert.deepEqual(
    rows.map((purchase) => purchase.createdAt),
    [...rows.map((purchase) => purchase.createdAt)].sort().reverse()
  )
  assert.equal(api.current().hasMore, false)
  assert.equal(globalThis.__listeners.size, 0)
  tree.unmount()
})

test('terminal cancellation and review states remain visible after leaving pending', async () => {
  for (const status of ['cancelled', 'needs_review', 'held_in_case']) {
    let backendPending = pending
    const tree = setup({ pendingPurchase: async () => backendPending })
    await settle()
    const listener = globalThis.__listeners.get(`cash-purchase-${pending.id}`)
    backendPending = null
    api.act(() => listener({ new: { ...pending, status } }))
    assert.equal(api.current().pendingPurchase, null)
    assert.equal(
      api.current().purchases.find((purchase) => purchase.id === pending.id).status,
      status
    )
    assert.equal(api.current().lastRealtimeCredit, null)
    tree.unmount()
  }
})

test('late paginated response cannot restore pending after Realtime credit', async () => {
  let resolvePage
  const tree = setup({
    page: async (_userId, options) =>
      options?.cursor
        ? new Promise((resolve) => {
            resolvePage = resolve
          })
        : { items: firstPage, nextCursor: 'cursor-1' },
  })
  await settle()
  let loadingPage
  api.act(() => {
    loadingPage = api.current().loadMore()
  })
  const listener = globalThis.__listeners.get(`cash-purchase-${pending.id}`)
  api.act(() => listener({ new: { ...pending, status: 'credited' } }))
  resolvePage({ items: [pending], nextCursor: null })
  await api.act(async () => loadingPage)
  assert.equal(
    api.current().purchases.find((purchase) => purchase.id === pending.id).status,
    'credited'
  )
  assert.equal(api.current().purchases.filter((purchase) => purchase.id === pending.id).length, 1)
  tree.unmount()
})

test('failed pending lookup is not an authoritative absence; retry resolves it', async () => {
  let fail = true
  const tree = setup({
    pendingPurchase: async () => {
      if (fail) throw new Error('NETWORK')
      return null
    },
  })
  await settle()
  assert.match(api.current().error, /Não foi possível carregar/)
  fail = false
  let result
  await api.act(async () => {
    result = await api.current().refresh()
  })
  assert.deepEqual(result, { ok: true, pendingPurchase: null })
  tree.unmount()
})

test('late response from previous user cannot expose their purchases', async () => {
  let resolveOld
  const tree = setup({
    page: (userId) =>
      userId === 'user-1'
        ? new Promise((resolve) => {
            resolveOld = resolve
          })
        : Promise.resolve({ items: [row('user-2-row', 10)], nextCursor: null }),
    pendingPurchase: async () => null,
  })
  tree.update('user-2')
  await settle()
  resolveOld({ items: firstPage, nextCursor: null })
  await settle()
  assert.deepEqual(
    api.current().purchases.map((purchase) => purchase.id),
    ['user-2-row']
  )
  assert.equal(api.current().pendingPurchase, null)
  tree.unmount()
})

test('old Realtime callback is ignored after switching users', async () => {
  const tree = setup({
    page: async (userId) => ({
      items: userId === 'user-1' ? firstPage : [row('user-2-row', 10)],
      nextCursor: null,
    }),
    pendingPurchase: async (userId) => (userId === 'user-1' ? pending : null),
  })
  await settle()
  const oldListener = globalThis.__listeners.get(`cash-purchase-${pending.id}`)
  tree.update('user-2')
  await settle()
  api.act(() => oldListener({ new: { ...pending, status: 'credited' } }))
  assert.deepEqual(
    api.current().purchases.map((purchase) => purchase.id),
    ['user-2-row']
  )
  assert.equal(api.current().lastRealtimeCredit, null)
  tree.unmount()
})

import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Mesmo raciocínio de WalletContext.test.js: react-test-renderer real (nunca
// TestRenderer + act(async ...), que trava este ambiente -- ver histórico da Fase
// Wallet), só act() síncrono. Trabalho assíncrono (a Promise de listMyCashPurchasesPage)
// sempre roda FORA de qualquer act(); um act(() => {}) vazio (flushSync) depois é quem
// comita o setState pendente.
let directory
let harness

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cash-purchases-tests-'))
  const outfile = join(directory, 'out.cjs')

  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { useCashPurchases } from './useCashPurchases.js'
        import { emitSnapshot as rawEmitSnapshot, activeSubscriptionCount, resetSubscriptions } from 'firebase/firestore'

        let latest = null
        let renderer = null

        export function mount(props) {
          act(() => {
            renderer = TestRenderer.create(
              createElement(function Harness() {
                latest = useCashPurchases(props.userId, props.admin, props.status)
                return null
              })
            )
          })
          return latest
        }

        export function setProps(props) {
          act(() => {
            renderer.update(
              createElement(function Harness() {
                latest = useCashPurchases(props.userId, props.admin, props.status)
                return null
              })
            )
          })
          return latest
        }

        export function flushSync() {
          act(() => {})
          return latest
        }

        export function unmount() {
          if (!renderer) return
          act(() => {
            renderer.unmount()
          })
          renderer = null
        }

        export function emitSnapshot(path, data) {
          act(() => {
            rawEmitSnapshot(path, data)
          })
          return latest
        }

        // Chamar latest.addPurchaseLocally(...) direto do teste, fora de act(), não dá
        // garantia de que o useEffect do listener de pending (cujas deps mudam com o novo
        // item) já tenha rodado antes da asserção -- mesmo motivo de emitSnapshot acima.
        export function addPurchaseLocally(purchase) {
          act(() => {
            latest.addPurchaseLocally(purchase)
          })
          return latest
        }

        export function reset() {
          unmount()
          latest = null
          resetSubscriptions()
        }

        export { activeSubscriptionCount }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'cash-purchases-test-stubs',
        setup(buildContext) {
          buildContext.onResolve({ filter: /firebase\/firestore$/ }, () => ({
            path: 'firebase-firestore',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /firebase\/config$/ }, () => ({
            path: 'firebase-config',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /services\/cashPurchaseService$/ }, () => ({
            path: 'cash-purchase-service',
            namespace: 'stub',
          }))

          buildContext.onLoad({ filter: /^firebase-config$/, namespace: 'stub' }, () => ({
            contents: `export const db = {}`,
          }))

          // doc(...) devolve os próprios argumentos (mesmo truque de WalletContext.test.js)
          // -- o primeiro elemento é o placeholder `db`, por isso activeSubscriptionCount/
          // emitSnapshot sempre pulam ref[0] ao reconstruir o path.
          buildContext.onLoad({ filter: /^firebase-firestore$/, namespace: 'stub' }, () => ({
            contents: `
              let subs = []
              export const doc = (...args) => args
              export const onSnapshot = (ref, onNext, onError) => {
                const path = ref.slice(1).join('/')
                const sub = { path, onNext, onError, active: true }
                subs.push(sub)
                return () => { sub.active = false }
              }
              export function emitSnapshot(path, data) {
                for (const sub of subs) {
                  if (sub.active && sub.path === path) sub.onNext({ exists: () => true, data: () => data })
                }
              }
              export function activeSubscriptionCount(path) {
                return subs.filter((s) => s.active && (!path || s.path === path)).length
              }
              export function resetSubscriptions() { subs = [] }
            `,
          }))

          buildContext.onLoad({ filter: /^cash-purchase-service$/, namespace: 'stub' }, () => ({
            contents: `
              globalThis.__purchasesByUser = globalThis.__purchasesByUser || {}
              export const listMyCashPurchasesPage = async (userId) => ({
                items: (globalThis.__purchasesByUser[userId] || []).slice(),
                nextCursor: null,
              })
              export const listCashPurchasesForAdminPage = async () => ({ items: [], nextCursor: null })
            `,
          }))
        },
      },
    ],
  })

  harness = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  globalThis.__purchasesByUser = {}
  harness.reset()
})

function seed(userId, items) {
  globalThis.__purchasesByUser[userId] = items
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

test('with no pending purchase, no listener is created', async () => {
  seed('alice', [{ id: 'c1', status: 'credited' }])
  harness.mount({ userId: 'alice', admin: false, status: '' })
  await settle()
  const result = harness.flushSync()
  assert.deepEqual(
    result.purchases.map((p) => p.id),
    ['c1']
  )
  assert.equal(harness.activeSubscriptionCount(), 0)
})

test('addPurchaseLocally prepends the new purchase immediately and starts a listener on it', async () => {
  seed('alice', [])
  harness.mount({ userId: 'alice', admin: false, status: '' })
  await settle()
  harness.flushSync()
  const after = harness.addPurchaseLocally({ id: 'p1', status: 'pending', packageLabel: 'Pacote', cashAmount: 10 })
  assert.deepEqual(
    after.purchases.map((p) => p.id),
    ['p1']
  )
  assert.equal(harness.activeSubscriptionCount('cashPurchases/p1'), 1)
})

test('addPurchaseLocally never duplicates an existing id', async () => {
  seed('alice', [])
  harness.mount({ userId: 'alice', admin: false, status: '' })
  await settle()
  harness.flushSync()
  harness.addPurchaseLocally({ id: 'p1', status: 'pending' })
  const result = harness.addPurchaseLocally({ id: 'p1', status: 'pending' })
  assert.equal(result.purchases.filter((p) => p.id === 'p1').length, 1)
})

test('admin confirming a pending purchase updates it to credited without reload, then the listener stops', async () => {
  seed('alice', [{ id: 'p1', status: 'pending', cashAmount: 10 }])
  harness.mount({ userId: 'alice', admin: false, status: '' })
  await settle()
  harness.flushSync()
  assert.equal(harness.activeSubscriptionCount('cashPurchases/p1'), 1)

  const updated = harness.emitSnapshot('cashPurchases/p1', { status: 'credited', cashAmount: 10 })
  assert.equal(updated.purchases.find((p) => p.id === 'p1').status, 'credited')
  assert.equal(harness.activeSubscriptionCount('cashPurchases/p1'), 0)
})

test('admin cancelling a pending purchase updates it to cancelled without reload, then the listener stops', async () => {
  seed('alice', [{ id: 'p2', status: 'pending', cashAmount: 20 }])
  harness.mount({ userId: 'alice', admin: false, status: '' })
  await settle()
  harness.flushSync()
  assert.equal(harness.activeSubscriptionCount('cashPurchases/p2'), 1)

  const updated = harness.emitSnapshot('cashPurchases/p2', { status: 'cancelled', cashAmount: 20 })
  assert.equal(updated.purchases.find((p) => p.id === 'p2').status, 'cancelled')
  assert.equal(harness.activeSubscriptionCount('cashPurchases/p2'), 0)
})

test('an initial "pending" event from the listener itself is a no-op, not a spurious update', async () => {
  seed('alice', [{ id: 'p3', status: 'pending', cashAmount: 30 }])
  harness.mount({ userId: 'alice', admin: false, status: '' })
  await settle()
  harness.flushSync()
  const result = harness.emitSnapshot('cashPurchases/p3', { status: 'pending', cashAmount: 30 })
  assert.equal(result.purchases.find((p) => p.id === 'p3').status, 'pending')
  assert.equal(harness.activeSubscriptionCount('cashPurchases/p3'), 1)
})

test('unmounting unsubscribes the pending listener', async () => {
  seed('alice', [{ id: 'p4', status: 'pending' }])
  harness.mount({ userId: 'alice', admin: false, status: '' })
  await settle()
  harness.flushSync()
  assert.equal(harness.activeSubscriptionCount('cashPurchases/p4'), 1)
  harness.unmount()
  assert.equal(harness.activeSubscriptionCount('cashPurchases/p4'), 0)
})

test('switching users clears the previous list immediately, tearing down the old pending listener', async () => {
  seed('alice', [{ id: 'p5', status: 'pending' }])
  seed('bob', [])
  harness.mount({ userId: 'alice', admin: false, status: '' })
  await settle()
  harness.flushSync()
  assert.equal(harness.activeSubscriptionCount('cashPurchases/p5'), 1)

  const afterSwitch = harness.setProps({ userId: 'bob', admin: false, status: '' })
  assert.deepEqual(afterSwitch.purchases, [])
  assert.equal(harness.activeSubscriptionCount('cashPurchases/p5'), 0)

  await settle()
  const settled = harness.flushSync()
  assert.deepEqual(settled.purchases, [])
  assert.equal(harness.activeSubscriptionCount(), 0)
})

test('admin mode never creates a pending listener, even with a pending item in the page', async () => {
  harness.mount({ userId: 'admin-1', admin: true, status: '' })
  await settle()
  const result = harness.flushSync()
  assert.equal(result.purchases.length, 0)
  assert.equal(harness.activeSubscriptionCount(), 0)
})

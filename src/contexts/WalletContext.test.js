import { after, afterEach, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

// Carteira no header: valores do SERVIDOR online, último valor conhecido (snapshot) offline, "—" sem
// snapshot -- e o saldo guardado NUNCA vira o `wallet` autêntico que outras telas usam para decidir gasto.
const require = createRequire(import.meta.url)
let directory
let on
let off

async function bundle(name, env) {
  const outfile = join(directory, `${name}.cjs`)
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { AuthContext } from './AuthContext.jsx'
        import { WalletProvider } from './WalletContext.jsx'
        import { useWallet } from '../hooks/useWallet.js'
        import { WalletHeaderBadges } from '../components/WalletHeaderBadges.jsx'
        import { saoPauloDayKey } from '../utils/qualifiedActivity.js'
        import { closeDatabase } from '../services/offline/database.js'
        import { readOfflineEntry } from '../services/offline/bootstrapEntry.js'
        import { saveBootstrap, buildBootstrapRecord } from '../services/offline/bootstrap.js'
        import { saveHomeSnapshot } from '../services/offline/homeSnapshot.js'

        let latest = null
        function Probe() { latest = useWallet(); return null }
        export const wallet = () => latest
        export const mount = (auth) => {
          let tree
          const tree$ = (value) => createElement(MemoryRouter, null,
            createElement(AuthContext.Provider, { value },
              createElement(WalletProvider, null, createElement(Probe), createElement(WalletHeaderBadges))))
          act(() => { tree = TestRenderer.create(tree$(auth)) })
          return { tree, update: (next) => act(() => tree.update(tree$(next))), unmount: () => act(() => tree.unmount()) }
        }
        export { act, saoPauloDayKey, closeDatabase, readOfflineEntry, saveBootstrap, buildBootstrapRecord, saveHomeSnapshot }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    bundle: true,
    write: true,
    outfile,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'error',
    define: { 'import.meta.env': JSON.stringify(env) },
    plugins: [
      {
        name: 'supabase-config-stub',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/supabase\/config$/ }, (args) => ({ path: args.path, namespace: 'stub' }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: `
              const thenable = (run) => ({ then: (res, rej) => Promise.resolve().then(run).then(res, rej) })
              export const supabase = {
                auth: { getSession: async () => ({ data: { session: null } }) },
                rpc: (name, params) => thenable(() => globalThis.__rpc(name, params)),
                channel: (name) => {
                  const channel = {
                    name,
                    handlers: [],
                    closed: false,
                    on(_type, _filter, handler) { channel.handlers.push(handler); return channel },
                    subscribe(callback) { globalThis.__channels.push(channel); callback?.('SUBSCRIBED'); return channel },
                    unsubscribe() { channel.closed = true },
                  }
                  return channel
                },
              }
            `,
          }))
        },
      },
    ],
  })
  return require(outfile)
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wallet-ctx-'))
  const common = { VITE_SUPABASE_URL: 'http://backend.test', VITE_SUPABASE_ANON_KEY: 'k', PROD: false }
  on = await bundle('on', { ...common, VITE_OFFLINE_COLD_START_ENABLED: 'true' })
  off = await bundle('off', common)
})
after(async () => {
  await on.closeDatabase()
  await off.closeDatabase()
  await rm(directory, { recursive: true, force: true })
})

const A = 'a0000000-0000-0000-0000-00000000000a'
const B = 'b0000000-0000-0000-0000-00000000000b'
const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
let calls
let walletRows // o que get_my_wallet devolve
let gate // promessa que segura get_my_wallet (reconexão)

const row = (coins, cash, lifetime = coins) => ({
  coin_balance: coins,
  lifetime_coins_earned: lifetime,
  cash_balance: cash,
})

beforeEach(async () => {
  await on.closeDatabase()
  await off.closeDatabase()
  globalThis.indexedDB = new IDBFactory()
  calls = []
  gate = null
  walletRows = row(20, 320, 35)
  globalThis.__channels = []
  globalThis.__rpc = async (name) => {
    calls.push(name)
    if (name === 'get_my_wallet') {
      if (gate) await gate
      return { data: walletRows, error: null }
    }
    if (name === 'get_my_evocoin_day') return { data: { dailyEarned: 3, dailyLimit: 10, day: on.saoPauloDayKey() }, error: null }
    return { data: null, error: null }
  }
  const store = new Map()
  globalThis.sessionStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i],
    get length() {
      return store.size
    },
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, userAgent: 'node' } })
})
afterEach(() => {
  delete globalThis.__rpc
})

const authOf = (uid, extra = {}) => ({
  user: { uid },
  deletionStatus: null,
  offlineLocal: false,
  offlineHome: null,
  ...extra,
})
const html = (tree) => JSON.stringify(tree.toJSON())
const valuesIn = (tree) =>
  tree.root.findAll((n) => n.props?.className === 'wallet-badge-value').map((n) => n.children.join(''))

const TODAY = () => on.saoPauloDayKey()
const SNAPSHOT_HOME = (extra = {}) => ({
  schema_version: 1,
  user_id: A,
  saved_at: Date.now(),
  wallet: { coinBalance: 20, lifetimeCoinsEarned: 35, cashBalance: 320, saved_at: Date.now() },
  daily_coins: { earned: 4, limit: 10, day: TODAY(), saved_at: Date.now() },
  ...extra,
})

// ------------------------------------------------------------------------------------------- online

test('ONLINE: o header mostra o saldo CONFIRMADO pelo servidor e o grava como snapshot (carteira + EvoCoins do dia)', async () => {
  const view = on.mount(authOf(A))
  await settle(60)
  const ctx = on.wallet()
  assert.deepEqual(ctx.wallet, { coinBalance: 20, lifetimeCoinsEarned: 35, cashBalance: 320 })
  assert.equal(ctx.display.source, 'server')
  assert.deepEqual(valuesIn(view.tree), ['20', '320'])
  await settle(60) // gravação do snapshot é em segundo plano
  const home = await readHome(A)
  assert.equal(home.wallet.coinBalance, 20)
  assert.equal(home.wallet.cashBalance, 320)
  assert.equal(home.daily_coins.earned, 3)
  view.unmount()
})

async function readHome(uid) {
  await on.saveBootstrap(
    on.buildBootstrapRecord({
      userId: uid,
      profile: { id: uid, username: uid, accountStatus: 'active', trainingPreferences: null },
      emailVerified: true,
      policy: null,
      allowed: true,
    })
  )
  return (await on.readOfflineEntry()).home
}

test('ONLINE: um evento Realtime atualiza o header e o snapshot', async () => {
  const view = on.mount(authOf(A))
  await settle(60)
  const channel = globalThis.__channels[0]
  walletRows = row(25, 330, 40)
  on.act(() => channel.handlers[0]({ new: walletRows }))
  assert.deepEqual(valuesIn(view.tree), ['25', '330'])
  await settle(60)
  assert.equal((await readHome(A)).wallet.cashBalance, 330)
  view.unmount()
})

test('build SEM cold start não grava snapshot nenhum (ele nunca seria lido)', async () => {
  const view = off.mount(authOf(A))
  await settle(60)
  assert.deepEqual(valuesIn(view.tree), ['20', '320'])
  await settle(60)
  const entry = await off.readOfflineEntry()
  assert.equal(entry.home, null)
  const db = await new Promise((resolve) => {
    const request = globalThis.indexedDB.open('evolutus-local-v1')
    request.onsuccess = () => resolve(request.result)
  })
  const rows = await new Promise((resolve) => {
    const request = db.transaction('syncMeta').objectStore('syncMeta').getAll()
    request.onsuccess = () => resolve(request.result)
  })
  db.close()
  assert.equal(rows.some((r) => r.key.endsWith(':home-snapshot')), false)
  view.unmount()
})

test('enquanto a primeira leitura não chega o header mostra "—" (nunca um 0 que pareça saldo)', async () => {
  let release
  gate = new Promise((resolve) => {
    release = resolve
  })
  const view = on.mount(authOf(A))
  await settle(30)
  assert.deepEqual(valuesIn(view.tree), ['—', '—'])
  assert.equal(on.wallet().display, null)
  release()
  await settle(40)
  assert.deepEqual(valuesIn(view.tree), ['20', '320'])
  view.unmount()
})

// ------------------------------------------------------------------------------------------ offline

test('OFFLINE com snapshot: o header mostra o último saldo conhecido, sem RPC e sem Realtime', async () => {
  const view = on.mount(authOf(A, { offlineLocal: true, offlineHome: SNAPSHOT_HOME() }))
  await settle(40)
  assert.deepEqual(valuesIn(view.tree), ['20', '320'])
  assert.equal(on.wallet().display.source, 'snapshot')
  assert.equal(html(view.tree).includes('último saldo conhecido'), true)
  assert.deepEqual(calls, [])
  assert.equal(globalThis.__channels.length, 0)
  assert.equal(on.wallet().dailyCoins.earned, 4)
  view.unmount()
})

test('SEGURANÇA: o saldo do snapshot é só exibição — o `wallet` autêntico fica vazio e nada local autoriza gasto', async () => {
  const view = on.mount(authOf(A, { offlineLocal: true, offlineHome: SNAPSHOT_HOME() }))
  await settle(40)
  const ctx = on.wallet()
  assert.deepEqual(ctx.wallet, { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 })
  assert.equal(ctx.display.coinBalance, 20)
  assert.equal(ctx.display.source, 'snapshot')
  view.unmount()
})

test('OFFLINE sem snapshot: "—" nos dois indicadores, nunca 0', async () => {
  const view = on.mount(authOf(A, { offlineLocal: true, offlineHome: null }))
  await settle(40)
  assert.deepEqual(valuesIn(view.tree), ['—', '—'])
  assert.equal(on.wallet().display, null)
  view.unmount()
})

test('saldo real ZERO guardado continua sendo mostrado como "0" (≠ indisponível)', async () => {
  const home = SNAPSHOT_HOME({ wallet: { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0, saved_at: 1 } })
  const view = on.mount(authOf(A, { offlineLocal: true, offlineHome: home }))
  await settle(40)
  assert.deepEqual(valuesIn(view.tree), ['0', '0'])
  view.unmount()
})

test('"EvoCoins de hoje" de um dia anterior NÃO é restaurado como se fosse de hoje', async () => {
  const home = SNAPSHOT_HOME({ daily_coins: { earned: 9, limit: 10, day: '2020-01-01', saved_at: 1 } })
  const view = on.mount(authOf(A, { offlineLocal: true, offlineHome: home }))
  await settle(40)
  assert.equal(on.wallet().dailyCoins, null)
  assert.deepEqual(valuesIn(view.tree), ['20', '320'])
  view.unmount()
})

// ------------------------------------------------------------------------- reconexão / troca de conta

test('RECONEXÃO: o último valor fica na tela até o servidor responder (sem "0" nem "—" no meio) e cada RPC roda UMA vez', async () => {
  const home = SNAPSHOT_HOME()
  const view = on.mount(authOf(A, { offlineLocal: true, offlineHome: home }))
  await settle(30)
  let release
  gate = new Promise((resolve) => {
    release = resolve
  })
  walletRows = row(26, 340, 41)
  view.update(authOf(A)) // voltou a rede: AuthContext virou online e limpou offlineHome
  await settle(30)
  assert.deepEqual(valuesIn(view.tree), ['20', '320'], 'valor conhecido enquanto a leitura fresca não chega')
  release()
  await settle(40)
  assert.deepEqual(valuesIn(view.tree), ['26', '340'])
  assert.equal(on.wallet().display.source, 'server')
  assert.equal(calls.filter((name) => name === 'get_my_wallet').length, 1)
  assert.equal(calls.filter((name) => name === 'get_my_evocoin_day').length, 1)
  assert.equal(globalThis.__channels.length, 1)
  view.unmount()
})

test('TROCA DE CONTA: o saldo de A nunca aparece para B, nem por um instante', async () => {
  const view = on.mount(authOf(A, { offlineLocal: true, offlineHome: SNAPSHOT_HOME() }))
  await settle(30)
  assert.deepEqual(valuesIn(view.tree), ['20', '320'])
  let release
  gate = new Promise((resolve) => {
    release = resolve
  })
  view.update(authOf(B))
  await settle(30)
  assert.deepEqual(valuesIn(view.tree), ['—', '—'])
  assert.equal(on.wallet().display, null)
  walletRows = row(1, 2, 1)
  release()
  await settle(40)
  assert.deepEqual(valuesIn(view.tree), ['1', '2'])
  view.unmount()
})

test('LOGOUT: sem usuário o header some e nenhum valor fica na memória', async () => {
  const view = on.mount(authOf(A, { offlineLocal: true, offlineHome: SNAPSHOT_HOME() }))
  await settle(30)
  view.update({ user: null, deletionStatus: null, offlineLocal: false, offlineHome: null })
  await settle(30)
  assert.equal(on.wallet().display, null)
  assert.deepEqual(valuesIn(view.tree), [])
  view.unmount()
})

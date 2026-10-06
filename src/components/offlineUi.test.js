import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

// UI: PwaControls (bloqueio offline x flag de escrita) e SyncStatus (estados e ações). Mesmo padrão dos
// outros testes de componente: react-test-renderer + esbuild, window/document mínimos, Supabase falso.
const require = createRequire(import.meta.url)
let directory
let on
let off
let cold

async function bundle(name, env) {
  const outfile = join(directory, `${name}.cjs`)
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { PwaControls } from './PwaControls.jsx'
        import { SyncStatus } from './SyncStatus.jsx'
        import { AuthContext } from '../contexts/AuthContext.jsx'
        export * as status from '../services/offline/syncStatusStore.js'
        export * as outbox from '../services/offline/outbox.js'
        export { closeDatabase } from '../services/offline/database.js'

        const wrap = (child, user) =>
          createElement(ThemeProvider, null,
            createElement(BaseStyles, null,
              createElement(AuthContext.Provider, { value: { user } }, child)))

        export const renderPwa = () => {
          let tree
          act(() => { tree = TestRenderer.create(wrap(createElement(PwaControls), null)) })
          return tree
        }
        export const renderSyncStatus = (user = { uid: 'user-a' }) => {
          let tree
          act(() => { tree = TestRenderer.create(wrap(createElement(SyncStatus), user)) })
          return { tree, rerender: () => act(() => tree.update(wrap(createElement(SyncStatus), user))) }
        }
        export { act }
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
          pluginBuild.onResolve({ filter: /\/supabase\/config$/ }, (args) => ({
            path: args.path,
            namespace: 'stub',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: `export const supabase = { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: () => ({ abortSignal: async () => ({ data: null, error: null }) }) }`,
          }))
        },
      },
    ],
  })
  return require(outfile)
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'offline-ui-'))
  on = await bundle('on', { VITE_OFFLINE_WRITE_ENABLED: 'true', PROD: false })
  off = await bundle('off', { PROD: false })
  cold = await bundle('cold', { VITE_OFFLINE_COLD_START_ENABLED: 'true', PROD: false })
})

after(async () => {
  await on.closeDatabase()
  await off.closeDatabase()
  await cold.closeDatabase()
  await rm(directory, { recursive: true, force: true })
})

let listeners
let content

function installBrowser({ onLine }) {
  listeners = new Map()
  content = { inert: false, id: 'app-content' }
  const add = (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn])
  const remove = (name, fn) =>
    listeners.set(
      name,
      (listeners.get(name) || []).filter((f) => f !== fn)
    )
  globalThis.window = {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    addEventListener: add,
    removeEventListener: remove,
    location: { reload: () => {} },
  }
  globalThis.document = {
    getElementById: (id) => (id === 'app-content' ? content : null),
    activeElement: null,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine, userAgent: 'node', platform: 'linux', maxTouchPoints: 0 },
    configurable: true,
  })
}
const fire = (name) => (listeners.get(name) || []).forEach((fn) => fn({}))
const setOnLine = (value) =>
  Object.defineProperty(globalThis, 'navigator', {
    value: { ...globalThis.navigator, onLine: value },
    configurable: true,
  })
const json = (tree) => JSON.stringify(tree.toJSON())
const shows = (tree) => json(tree).includes('sync-status')

beforeEach(async () => {
  await on.closeDatabase()
  await off.closeDatabase()
  await cold.closeDatabase()
  globalThis.indexedDB = new IDBFactory()
  installBrowser({ onLine: true }) // antes do reset: o estado inicial do store lê navigator.onLine
  on.status.resetSyncStatusForTests()
  off.status.resetSyncStatusForTests()
})

// ----------------------------------------------------------------------------------- PwaControls

test('flag ligada: ficar OFFLINE não bloqueia o app (sem tela cheia e sem inert)', () => {
  installBrowser({ onLine: false })
  const tree = on.renderPwa()
  assert.equal(json(tree).includes('pwa-offline'), false)
  assert.equal(json(tree).includes('Você está sem conexão'), false)
  assert.equal(content.inert, false)
  // E cair da rede DEPOIS de aberto também não bloqueia.
  installBrowser({ onLine: true })
  const second = on.renderPwa()
  setOnLine(false)
  on.act(() => fire('offline'))
  assert.equal(json(second).includes('pwa-offline'), false)
  assert.equal(content.inert, false)
})

test('flag DESLIGADA (padrão): o comportamento anterior é preservado — tela cheia e conteúdo inerte offline', () => {
  installBrowser({ onLine: false })
  const tree = off.renderPwa()
  assert.equal(json(tree).includes('pwa-offline'), true)
  assert.equal(json(tree).includes('Você está sem conexão'), true)
  assert.equal(content.inert, true)
  setOnLine(true)
  off.act(() => fire('online'))
  assert.equal(json(tree).includes('pwa-offline'), false)
  assert.equal(content.inert, false)
})

// ------------------------------------------------------------------------------------- SyncStatus

const visibleText = (tree) =>
  tree.root
    .findAll((n) => n.props?.className === 'sync-status-text')
    .map((n) => n.children.join(''))

test('SyncStatus: oculto quando está tudo em dia', () => {
  const { tree } = on.renderSyncStatus()
  assert.equal(shows(tree), false)
})

test('SyncStatus: "Salvando…" -> "N alterações aguardando" -> "Sincronizando…" -> "Sincronizado"', () => {
  on.status.setSyncUser('user-a')
  const { tree } = on.renderSyncStatus()
  on.act(() => on.status.setSaving(true))
  assert.deepEqual(visibleText(tree), ['Salvando neste aparelho…'])
  on.act(() => {
    on.status.setSaving(false)
  })
  assert.equal(shows(tree), false)
  // pendências vêm do IndexedDB; aqui injeta o espelho já contado
  on.act(() => on.status.setOnline(true))
  return on.outbox
    .enqueueWorkoutMutation('user-a', {
      operation: 'workout.create',
      entityId: 'e1',
      payload: {
        exercise_id: 'x',
        date: '2026-10-05',
        type: 'strength',
        set_details: [{ weight: 1, reps: 1 }],
        sets: 1,
        note: '',
      },
    })
    .then(() => on.status.refreshSyncStatus('user-a'))
    .then(() => {
      assert.deepEqual(visibleText(tree), ['1 alteração aguardando sincronização'])
      assert.ok(json(tree).includes('Sincronizar agora'))
      on.act(() => on.status.setSyncing(true))
      assert.deepEqual(visibleText(tree), ['Sincronizando…'])
      on.act(() => {
        on.status.setSyncing(false)
        on.status.markSynced()
      })
    })
})

test('SyncStatus: offline sem pendências e com pendências; offline não oferece "Sincronizar agora"', async () => {
  on.status.setSyncUser('user-a')
  const { tree } = on.renderSyncStatus()
  on.act(() => on.status.setOnline(false))
  assert.deepEqual(visibleText(tree), ['Offline • dados deste aparelho'])
  await on.outbox.enqueueWorkoutMutation('user-a', {
    operation: 'workout.create',
    entityId: 'e1',
    payload: {
      exercise_id: 'x',
      date: '2026-10-05',
      type: 'strength',
      set_details: [{ weight: 1, reps: 1 }],
      sets: 1,
      note: '',
    },
  })
  await on.status.refreshSyncStatus('user-a')
  on.act(() => {})
  assert.deepEqual(visibleText(tree), ['Offline • 1 alteração salva neste aparelho'])
  assert.equal(json(tree).includes('Sincronizar agora'), false)
})

test('SyncStatus: falha mostra a contagem e as opções de resolver; "pendência após reload" volta do IndexedDB', async () => {
  const payload = {
    exercise_id: 'x',
    date: '2026-10-05',
    type: 'strength',
    set_details: [{ weight: 1, reps: 1 }],
    sets: 1,
    note: '',
  }
  await on.outbox.enqueueWorkoutMutation('user-a', {
    operation: 'workout.create',
    entityId: 'e1',
    payload,
  })
  // "Reload": estado em memória zerado; a UI se reconstrói só do IndexedDB.
  on.status.resetSyncStatusForTests()
  on.status.setSyncUser('user-a')
  const { tree } = on.renderSyncStatus()
  await on.status.refreshSyncStatus('user-a')
  on.act(() => {})
  assert.deepEqual(visibleText(tree), ['1 alteração aguardando sincronização'])

  const [claimed] = await on.outbox.claimNextBatch('user-a')
  await on.outbox.failMutation('user-a', claimed.mutation_id, { code: 'CONFLICT' })
  await on.status.refreshSyncStatus('user-a')
  on.act(() => {})
  assert.deepEqual(visibleText(tree), ['Falha ao sincronizar'])
  assert.ok(json(tree).includes('1 alteração precisa de atenção'))
  assert.ok(json(tree).includes('Ver detalhes'))
})

test('SyncStatus com a flag desligada e sem pendências: não aparece nem offline', () => {
  off.status.setSyncUser('user-a')
  const { tree } = off.renderSyncStatus()
  off.act(() => off.status.setOnline(false))
  assert.equal(shows(tree), false)
})

// ---- Cold start offline LIGADO e escrita offline DESLIGADA: combinações de flags independentes ----------------

test('só cold start ligado (escrita desligada): offline NÃO bloqueia a casca — é o que permite abrir o app offline', () => {
  installBrowser({ onLine: false })
  const tree = cold.renderPwa()
  assert.equal(json(tree).includes('pwa-offline'), false)
  assert.equal(content.inert, false)
})

test('os modos offline são independentes: leitura/escrita/cold start combinam sem acoplamento', async () => {
  const database = await import('./../services/offline/database.js')
  const combos = [
    [{ VITE_OFFLINE_WRITE_ENABLED: 'true' }, { write: true, cold: false, shell: true }],
    [{ VITE_OFFLINE_COLD_START_ENABLED: 'true' }, { write: false, cold: true, shell: true }],
    [
      { VITE_OFFLINE_WRITE_ENABLED: 'true', VITE_OFFLINE_COLD_START_ENABLED: 'true' },
      { write: true, cold: true, shell: true },
    ],
    [{}, { write: false, cold: false, shell: false }],
    // cold start precisa do banco local: com a LEITURA desligada ele não liga (sem IndexedDB não há bootstrap)
    [
      { VITE_OFFLINE_COLD_START_ENABLED: 'true', VITE_OFFLINE_READ_ENABLED: 'false' },
      { write: false, cold: false, shell: false },
    ],
    [{ VITE_OFFLINE_COLD_START_ENABLED: 'sim' }, { write: false, cold: false, shell: false }], // só 'true' exato
  ]
  for (const [env, expected] of combos) {
    assert.equal(database.isOfflineWriteEnabled(env), expected.write, JSON.stringify(env))
    assert.equal(database.isOfflineColdStartEnabled(env), expected.cold, JSON.stringify(env))
    assert.equal(database.isOfflineShellEnabled(env), expected.shell, JSON.stringify(env))
  }
})

test('o sync e o push só ligam com a sessão CONFIRMADA: o Layout os desliga no modo offline local', async () => {
  const { readFileSync } = await import('node:fs')
  const layout = readFileSync(new URL('./Layout.jsx', import.meta.url), 'utf8')
  assert.match(layout, /useSyncScheduler\(syncAuthorized \? user\?\.uid : null\)/)
  assert.match(layout, /!offlineLocal\s*&&\s*serverAccessAllowed/)
  assert.match(layout, /usePushSubscriptionSync\(Boolean\(profile\) && !offlineLocal/)
  assert.match(layout, /offlineLocal &&/) // aviso discreto de modo offline
})

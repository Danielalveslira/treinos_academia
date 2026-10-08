import { after, afterEach, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

// AuthProvider REAL (React + react-test-renderer) com Supabase falso, para provar o cold start offline, a
// revalidação ao reconectar e o que NUNCA pode acontecer (confundir cache local com sessão do servidor).
const require = createRequire(import.meta.url)
let directory
let on
let off
let prod

async function bundle(name, env) {
  const outfile = join(directory, `${name}.cjs`)
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { AuthProvider } from './AuthContext.jsx'
        import { useAuth } from '../hooks/useAuth.js'
        import { logoutUser } from '../services/authService.js'
        import { LEGAL_MANIFEST, LEGAL_DOCUMENTS, APPROVED_LEGAL_DIGESTS, resolveLegalGateState } from '../utils/legal.js'
        import * as bootstrapMain from '../services/offline/bootstrap.js'
        import * as bootstrapEntry from '../services/offline/bootstrapEntry.js'
        const bootstrap = { ...bootstrapMain, ...bootstrapEntry }
        import * as outbox from '../services/offline/outbox.js'
        import * as history from '../services/offline/historyCache.js'
        import { closeDatabase } from '../services/offline/database.js'
        import { setRemoteRolloutSnapshot } from '../services/offline/rollout.js'
        import { consumeLogoutReason } from '../utils/logoutReason.js'

        let latest = null
        function Probe() { latest = useAuth(); return null }
        export const mount = () => {
          let tree
          act(() => { tree = TestRenderer.create(createElement(AuthProvider, null, createElement(Probe))) })
          return { tree, unmount: () => act(() => tree.unmount()) }
        }
        export const auth = () => latest
        export { act, logoutUser, setRemoteRolloutSnapshot, bootstrap, outbox, history, closeDatabase, consumeLogoutReason, resolveLegalGateState, LEGAL_MANIFEST, LEGAL_DOCUMENTS, APPROVED_LEGAL_DIGESTS }
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
            contents: `
              const listeners = new Set()
              const emit = async (event, session) => { for (const cb of [...listeners]) await cb(event, session) }
              globalThis.__emitFor = globalThis.__emitFor || {}
              globalThis.__emitFor[Math.random()] = emit
              const thenable = (run) => ({ select() { return this }, eq() { return this }, maybeSingle() { return this }, single() { return this }, then: (res, rej) => Promise.resolve(run()).then(res, rej) })
              export const supabase = {
                auth: {
                  onAuthStateChange(cb) {
                    listeners.add(cb)
                    Promise.resolve().then(() => cb('INITIAL_SESSION', globalThis.__initialSession ?? null))
                    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
                  },
                  getSession: async () => globalThis.__getSession(),
                  signOut: async () => { globalThis.__session = null; await emit('SIGNED_OUT', null); return { error: null } },
                },
                rpc: (name, params) => thenable(() => globalThis.__rpc(name, params)),
                from: (table) => thenable(() => globalThis.__from(table)),
                channel: () => ({ on() { return this }, subscribe() { return this }, unsubscribe() {} }),
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
  directory = await mkdtemp(join(tmpdir(), 'auth-cold-start-'))
  on = await bundle('on', {
    VITE_OFFLINE_COLD_START_ENABLED: 'true',
    VITE_SUPABASE_URL: 'http://backend.test',
    VITE_SUPABASE_ANON_KEY: 'k',
  })
  prod = await bundle('prod', {
    PROD: true,
    VITE_OFFLINE_WRITE_ENABLED: 'true',
    VITE_OFFLINE_COLD_START_ENABLED: 'true',
    VITE_SUPABASE_URL: 'http://backend.test',
    VITE_SUPABASE_ANON_KEY: 'k',
  })
  off = await bundle('off', {
    VITE_SUPABASE_URL: 'http://backend.test',
    VITE_SUPABASE_ANON_KEY: 'k',
  })
})
after(async () => {
  await on.closeDatabase()
  await off.closeDatabase()
  await prod.closeDatabase()
  await rm(directory, { recursive: true, force: true })
})

const A = 'a0000000-0000-0000-0000-00000000000a'
const B = 'b0000000-0000-0000-0000-00000000000b'
const NETWORK = { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' }
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))
const NOW_ISO = '2026-10-05T10:00:00.000Z'

let world
let browser // estado simulado do navegador

function userRow(id, overrides = {}) {
  const [version, digest] = Object.entries(on.APPROVED_LEGAL_DIGESTS).at(-1)
  return {
    id,
    role: 'user',
    created_at: '2026-10-01T10:00:00Z',
    username: id === A ? 'maria' : 'joao',
    bio: 'privada',
    data_nascimento: '1990-01-01',
    account_status: 'active',
    training_preferences: null,
    legal_acceptance_version: version,
    legal_acceptance_digest: digest,
    legal_acceptance_accepted_at: NOW_ISO,
    ...overrides,
  }
}
const supaUser = (id) => ({ id, email: `${id.slice(0, 1)}@teste.dev`, email_confirmed_at: NOW_ISO })

function setNavigator(onLine) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine, userAgent: 'node', storage: browser.storage },
  })
}

beforeEach(async () => {
  await on.closeDatabase()
  await off.closeDatabase()
  await prod.closeDatabase()
  globalThis.indexedDB = new IDBFactory()
  const [version, digest] = Object.entries(on.APPROVED_LEGAL_DIGESTS).at(-1)
  world = {
    online: true, // o backend responde
    users: { [A]: userRow(A), [B]: userRow(B) },
    policy: { version, digest, published: true, published_at: NOW_ISO },
    archive: { version, digest, manifest: on.LEGAL_MANIFEST, documents: on.LEGAL_DOCUMENTS },
    refreshFails: null, // erro devolvido por getSession ao tentar renovar
    calls: [],
  }
  browser = {
    storage: {
      persisted: async () => false,
      persist: async () => true,
      estimate: async () => ({ usage: 1, quota: 100 }),
    },
  }
  globalThis.__initialSession = null
  globalThis.__session = null
  globalThis.__getSession = async () =>
    globalThis.__session
      ? { data: { session: globalThis.__session }, error: null }
      : { data: { session: null }, error: world.refreshFails }
  globalThis.__rpc = async (name) => {
    world.calls.push(name)
    if (!world.online) return { data: null, error: NETWORK }
    if (name === 'has_app_access') return { data: world.access ?? true, error: null }
    if (name === 'ensure_user_profile')
      return { data: world.users[globalThis.__session.user.id], error: null }
    return { data: null, error: null } // get_my_deletion_review etc.
  }
  globalThis.__from = async (table) => {
    world.calls.push(`from:${table}`)
    if (!world.online) return { data: null, error: NETWORK }
    if (table === 'legal_policy') return { data: world.policy, error: null }
    if (table === 'legal_versions') return { data: world.archive, error: null }
    return { data: null, error: null }
  }
  globalThis.fetch = async () => {
    if (!world.online) throw new TypeError('Failed to fetch')
    return { status: 200 }
  }
  globalThis.sessionStorage = (() => {
    const m = new Map()
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => m.set(k, v),
      removeItem: (k) => m.delete(k),
      key: (i) => [...m.keys()][i],
      get length() {
        return m.size
      },
    }
  })()
  const listeners = new Map()
  globalThis.window = {
    addEventListener: (n, f) => listeners.set(n, [...(listeners.get(n) || []), f]),
    removeEventListener: (n, f) =>
      listeners.set(
        n,
        (listeners.get(n) || []).filter((x) => x !== f)
      ),
    __fire: (n) => (listeners.get(n) || []).forEach((f) => f({})),
  }
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  setNavigator(true)
})
afterEach(() => {
  delete globalThis.__initialSession
})

const login = (id) => {
  globalThis.__session = { user: supaUser(id), access_token: 't', expires_at: 9e9 }
  globalThis.__initialSession = globalThis.__session
}

// Sessão do Supabase existe (token válido) e o usuário abre o app: caminho online normal.
async function onlineLogin(bundleUnderTest, id) {
  login(id)
  const view = bundleUnderTest.mount()
  await settle(80)
  return view
}

// ============================================================================ bootstrap por login online

test('login ONLINE confirma perfil+termos e grava o bootstrap MÍNIMO (cold start ligado)', async () => {
  world.users[A] = userRow(A, { role: 'superadmin' })
  const view = await onlineLogin(on, A)
  const ctx = on.auth()
  assert.equal(ctx.offlineLocal, false)
  assert.equal(ctx.loading, false)
  assert.equal(ctx.profile.role, 'superadmin') // online, o papel vem do servidor
  const record = await on.bootstrap.readActiveBootstrap()
  assert.equal(record.user_id, A)
  assert.equal(record.offline_access.enabled, true)
  assert.equal(record.profile.username, 'maria')
  assert.ok(!('role' in record.profile))
  assert.ok(
    !JSON.stringify(record).includes('privada') &&
      !JSON.stringify(record).includes('1990') &&
      !JSON.stringify(record).includes('@')
  )
  view.unmount()
})

test('flag DESLIGADA (padrão): nada de bootstrap, e offline o comportamento é o de antes (erro de perfil)', async () => {
  let view = await onlineLogin(off, A)
  assert.equal(await off.bootstrap.readActiveBootstrap(), null)
  view.unmount()
  world.online = false
  setNavigator(false)
  view = await onlineLogin(off, A)
  assert.equal(off.auth().offlineLocal, false)
  assert.match(off.auth().profileError, /Recarregue a página/)
  view.unmount()
})

// ============================================================================ COLD START offline

test('COLD START: login online, "fecha" o app, fica sem internet e reabre -> entra OFFLINE com o perfil mínimo (sessão ainda válida)', async () => {
  let view = await onlineLogin(on, A)
  view.unmount()
  world.online = false
  setNavigator(false)
  view = await onlineLogin(on, A) // token ainda válido no storage do Supabase, mas o backend não responde
  const ctx = on.auth()
  assert.equal(ctx.offlineLocal, true)
  assert.equal(ctx.loading, false)
  assert.equal(ctx.profileError, '')
  assert.equal(ctx.user.offline, true) // usuário RECONHECIDO LOCALMENTE, não sessão confirmada
  assert.equal(ctx.user.uid, A)
  assert.equal(ctx.profile.username, 'maria')
  assert.equal(ctx.profile.role, 'user') // nada de privilégio por cache
  assert.equal(
    on.resolveLegalGateState({
      profile: ctx.profile,
      access: ctx.legalAccess,
      loading: false,
      error: '',
    }),
    'allowed'
  )
  assert.ok(Number.isFinite(ctx.offlineVerifiedAt))
  view.unmount()
})

test('COLD START com a SESSÃO EXPIRADA e sem rede (Supabase entrega INITIAL_SESSION nulo): entra offline e NÃO limpa os caches', async () => {
  let view = await onlineLogin(on, A)
  await on.history.recordWorkoutsPage(
    A,
    [
      {
        user_id: A,
        id: 'w1',
        exercise_id: 'x',
        date: '2026-10-05',
        created_at: '2026-10-05T10:00:00.000000+00:00',
      },
    ],
    { now: Date.UTC(2026, 9, 5, 12) }
  )
  await on.outbox.enqueueWorkoutMutation(A, {
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
  view.unmount()
  world.online = false
  setNavigator(false)
  globalThis.__session = null // token venceu e o refresh falhou por rede: o SDK não entrega sessão
  globalThis.__initialSession = null
  world.refreshFails = { name: 'AuthRetryableFetchError', message: 'fetch failed' }
  view = on.mount()
  await settle(120)
  const ctx = on.auth()
  assert.equal(ctx.offlineLocal, true) // sessão expirada/rede ruim NÃO é logout
  assert.equal(ctx.user.uid, A)
  assert.equal(
    (await on.history.readCachedWorkouts(A)).rows.some((r) => r.id === 'w1'),
    true
  ) // histórico local intacto
  assert.equal((await on.outbox.listMutations(A)).length, 1) // fila intacta
  view.unmount()
})

test('PRIMEIRO acesso sem internet (sem bootstrap): não entra e diz o que fazer — sem tela quebrada nem loop', async () => {
  world.online = false
  setNavigator(false)
  const view = await onlineLogin(on, A) // há sessão salva no navegador, mas nunca houve login confirmado online AQUI
  const ctx = on.auth()
  assert.equal(ctx.offlineLocal, false)
  assert.equal(ctx.loading, false)
  assert.equal(ctx.profileError, 'Conecte-se à internet para entrar no Evolutus neste aparelho.')
  view.unmount()
  // Sem sessão alguma: tela de login (user nulo), também sem loop.
  globalThis.__session = null
  globalThis.__initialSession = null
  const second = on.mount()
  await settle(100)
  assert.equal(on.auth().user, null)
  assert.equal(on.auth().loading, false)
  second.unmount()
})

test('bootstrap CORROMPIDO ou IndexedDB INDISPONÍVEL: falha segura (não entra offline)', async () => {
  let view = await onlineLogin(on, A)
  view.unmount()
  // corrompe o registro
  await new Promise((resolve) => {
    const open = indexedDB.open('evolutus-local-v1')
    open.onsuccess = () => {
      const tx = open.result.transaction('offlineBootstrap', 'readwrite')
      tx.objectStore('offlineBootstrap').put({
        user_id: A,
        schema_version: 1,
        offline_access: 'quebrado',
      })
      tx.oncomplete = () => {
        open.result.close()
        resolve()
      }
    }
  })
  await on.closeDatabase()
  world.online = false
  setNavigator(false)
  view = await onlineLogin(on, A)
  assert.equal(on.auth().offlineLocal, false)
  assert.match(on.auth().profileError, /Conecte-se à internet/)
  view.unmount()
  // IndexedDB indisponível
  await on.closeDatabase()
  const saved = globalThis.indexedDB
  globalThis.indexedDB = undefined
  view = await onlineLogin(on, A)
  assert.equal(on.auth().offlineLocal, false)
  assert.match(on.auth().profileError, /Conecte-se à internet/)
  view.unmount()
  globalThis.indexedDB = saved
})

// ============================================================================ LOGOUT x sessão expirada

test('LOGOUT explícito invalida o cold start; a outbox pendente continua guardada', async () => {
  let view = await onlineLogin(on, A)
  await on.outbox.enqueueWorkoutMutation(A, {
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
  await on.logoutUser() // authService: desliga o bootstrap ANTES do signOut, que dispara SIGNED_OUT
  await settle(80)
  assert.equal(on.auth().user, null)
  assert.equal(await on.bootstrap.readActiveBootstrap(), null)
  assert.equal((await on.outbox.listMutations(A)).length, 1)
  view.unmount()
  // Sem internet, o cache NÃO reabre a conta.
  world.online = false
  setNavigator(false)
  globalThis.__session = null
  globalThis.__initialSession = null
  view = on.mount()
  await settle(120)
  assert.equal(on.auth().offlineLocal, false)
  assert.equal(on.auth().user, null)
  assert.equal((await on.outbox.listMutations(A)).length, 1)
  view.unmount()
})

test('LOGOUT estando OFFLINE (modo offline local): sai, desliga o acesso offline e mantém a outbox', async () => {
  let view = await onlineLogin(on, A)
  view.unmount()
  world.online = false
  setNavigator(false)
  globalThis.__session = null
  globalThis.__initialSession = null
  view = on.mount()
  await settle(120)
  assert.equal(on.auth().offlineLocal, true)
  await on.outbox.enqueueWorkoutMutation(A, {
    operation: 'workout.create',
    entityId: 'e2',
    payload: {
      exercise_id: 'x',
      date: '2026-10-05',
      type: 'strength',
      set_details: [{ weight: 1, reps: 1 }],
      sets: 1,
      note: '',
    },
  })
  await on.logoutUser()
  await settle(120)
  assert.equal(on.auth().user, null)
  assert.equal(on.auth().offlineLocal, false)
  assert.equal(await on.bootstrap.readActiveBootstrap(), null)
  assert.equal((await on.outbox.listMutations(A)).length, 1)
  view.unmount()
})

test('A -> logout -> B (online) -> offline: abre como B e NUNCA expõe A; a outbox de A segue guardada', async () => {
  let view = await onlineLogin(on, A)
  await on.outbox.enqueueWorkoutMutation(A, {
    operation: 'workout.create',
    entityId: 'a1',
    payload: {
      exercise_id: 'x',
      date: '2026-10-05',
      type: 'strength',
      set_details: [{ weight: 1, reps: 1 }],
      sets: 1,
      note: '',
    },
  })
  await on.logoutUser()
  await settle(60)
  view.unmount()
  view = await onlineLogin(on, B)
  assert.equal(on.auth().profile.username, 'joao')
  view.unmount()
  world.online = false
  setNavigator(false)
  globalThis.__session = null
  globalThis.__initialSession = null
  view = on.mount()
  await settle(120)
  const ctx = on.auth()
  assert.equal(ctx.offlineLocal, true)
  assert.equal(ctx.user.uid, B)
  assert.equal(ctx.profile.username, 'joao')
  assert.ok(!JSON.stringify(await on.bootstrap.readActiveBootstrap()).includes(A))
  assert.equal((await on.outbox.listMutations(B)).length, 0) // B não vê a fila de A
  assert.equal((await on.outbox.listMutations(A)).length, 1)
  view.unmount()
})

test('troca direta de identidade A para B invalida o bootstrap de A antes de validar B', async () => {
  let view = await onlineLogin(on, A)
  view.unmount()
  world.online = false
  setNavigator(false)
  view = await onlineLogin(on, B)
  assert.equal(on.auth().offlineLocal, false)
  assert.equal(await on.bootstrap.readActiveBootstrap(), null)
  view.unmount()
})

test('SESSÃO EXPIRADA online (servidor responde e não há sessão) vai para o login, SEM ser tratada como logout: bootstrap e outbox ficam', async () => {
  let view = await onlineLogin(on, A)
  await on.outbox.enqueueWorkoutMutation(A, {
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
  view.unmount()
  globalThis.__session = null
  globalThis.__initialSession = null
  world.refreshFails = { name: 'AuthApiError', message: 'Invalid Refresh Token' }
  view = on.mount()
  await settle(100)
  assert.equal(on.auth().user, null) // backend alcançável + sem sessão = login de verdade
  assert.equal(on.auth().offlineLocal, false)
  assert.equal(on.bootstrap.evaluateOfflineEntry(await on.bootstrap.readActiveBootstrap()).ok, true)
  assert.equal((await on.outbox.listMutations(A)).length, 1)
  view.unmount()
})

// ============================================================================ RECONEXÃO

async function coldStartOffline(id = A) {
  let view = await onlineLogin(on, id)
  view.unmount()
  world.online = false
  setNavigator(false)
  globalThis.__session = null
  globalThis.__initialSession = null
  world.refreshFails = { name: 'AuthRetryableFetchError', message: 'fetch failed' }
  view = on.mount()
  await settle(120)
  assert.equal(on.auth().offlineLocal, true)
  return view
}

test('RECONEXÃO: revalida sessão, perfil e termos, vira sessão CONFIRMADA e atualiza o bootstrap (sem desmontar a tela)', async () => {
  world.users[A] = userRow(A, { role: 'superadmin' })
  const view = await coldStartOffline()
  const before = (await on.bootstrap.readActiveBootstrap()).last_online_verified_at
  world.calls.length = 0
  world.online = true
  setNavigator(true)
  globalThis.__session = { user: supaUser(A), access_token: 'novo', expires_at: 9e9 } // o refresh oficial funcionou
  world.refreshFails = null
  window.__fire('online')
  await settle(150)
  const ctx = on.auth()
  assert.equal(ctx.offlineLocal, false)
  assert.equal(ctx.loading, false) // revalidação SILENCIOSA: nunca liga o spinner que desmontaria formulários
  assert.equal(ctx.user.offline, undefined)
  assert.equal(ctx.profile.role, 'superadmin') // agora o papel vem do SERVIDOR de novo
  assert.ok(
    world.calls.includes('ensure_user_profile') && world.calls.includes('from:legal_policy')
  ) // perfil e termos revalidados
  assert.ok((await on.bootstrap.readActiveBootstrap()).last_online_verified_at >= before)
  view.unmount()
})

test('RECONEXÃO: sync só depois da revalidação — o Layout recebe offlineLocal=true até o servidor confirmar', async () => {
  const view = await coldStartOffline()
  assert.equal(on.auth().offlineLocal, true) // o Layout passa user=null ao scheduler enquanto isto for true
  world.online = true
  setNavigator(true)
  // Rede voltou, mas o refresh de sessão ainda NÃO funcionou (instável): continua offline local, nada liberado.
  world.refreshFails = { name: 'AuthRetryableFetchError', message: 'fetch failed' }
  window.__fire('online')
  await settle(120)
  assert.equal(on.auth().offlineLocal, true)
  view.unmount()
})

test('SESSÃO EXPIRADA por longo período offline: ao reconectar o refresh FALHA -> exige login online e a outbox permanece', async () => {
  const view = await coldStartOffline()
  await on.outbox.enqueueWorkoutMutation(A, {
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
  world.online = true
  setNavigator(true)
  world.refreshFails = {
    name: 'AuthApiError',
    message: 'Invalid Refresh Token: Refresh Token Not Found',
  } // definitivo
  window.__fire('online')
  await settle(200)
  const ctx = on.auth()
  assert.equal(ctx.user, null) // volta ao login
  assert.equal(ctx.offlineLocal, false)
  assert.match(on.consumeLogoutReason().message, /Sua sessão expirou/)
  assert.equal((await on.outbox.listMutations(A)).length, 1)
  assert.equal(on.bootstrap.evaluateOfflineEntry(await on.bootstrap.readActiveBootstrap()).ok, true) // não foi logout
  view.unmount()
})

test('RECONEXÃO com termos NOVOS: o gate abre, nada é aceito automaticamente, a outbox fica e o bootstrap deixa de permitir offline', async () => {
  const view = await coldStartOffline()
  await on.outbox.enqueueWorkoutMutation(A, {
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
  // O servidor agora exige uma versão que o usuário não aceitou (digest diferente do aceito).
  world.policy = { ...world.policy, digest: 'e'.repeat(64) }
  world.online = true
  setNavigator(true)
  globalThis.__session = { user: supaUser(A), access_token: 'novo', expires_at: 9e9 }
  world.refreshFails = null
  window.__fire('online')
  await settle(200)
  const ctx = on.auth()
  assert.equal(ctx.offlineLocal, false)
  // Com a política do servidor divergente do bundle conhecido, o app NÃO libera nem "aceita" por conta própria.
  assert.notEqual(
    on.resolveLegalGateState({
      profile: ctx.profile,
      access: ctx.legalAccess,
      loading: false,
      error: ctx.legalError,
    }),
    'allowed'
  )
  assert.equal(ctx.profile.legalAcceptance.digest, Object.values(on.APPROVED_LEGAL_DIGESTS).at(-1)) // aceite antigo intacto
  assert.equal((await on.outbox.listMutations(A)).length, 1)
  const record = await on.bootstrap.readActiveBootstrap()
  assert.equal(record.offline_access.enabled, false) // próxima abertura offline: não entra até aceitar online
  assert.equal(on.bootstrap.evaluateOfflineEntry(record).ok, false)
  view.unmount()
})

test('RECONEXÃO: conta DESATIVADA no servidor prevalece sobre o cache e bloqueia o acesso offline seguinte', async () => {
  const view = await coldStartOffline()
  world.users[A] = userRow(A, { account_status: 'disabled' })
  world.online = true
  setNavigator(true)
  globalThis.__session = { user: supaUser(A), access_token: 'novo', expires_at: 9e9 }
  world.refreshFails = null
  window.__fire('online')
  await settle(200)
  assert.equal(on.auth().profile.accountStatus, 'disabled') // o estado ONLINE prevalece
  assert.equal(
    on.bootstrap.evaluateOfflineEntry(await on.bootstrap.readActiveBootstrap()).ok,
    false
  )
  view.unmount()
})

test('RECONEXÃO: has_app_access negado mantém sync bloqueado e desabilita o bootstrap', async () => {
  const view = await coldStartOffline()
  world.access = false
  world.online = true
  setNavigator(true)
  globalThis.__session = { user: supaUser(A), access_token: 'novo', expires_at: 9e9 }
  world.refreshFails = null
  window.__fire('online')
  await settle(200)
  assert.equal(on.auth().offlineLocal, false)
  assert.equal(on.auth().serverAccessAllowed, false)
  assert.ok(world.calls.includes('has_app_access'))
  assert.equal(
    on.bootstrap.evaluateOfflineEntry(await on.bootstrap.readActiveBootstrap()).ok,
    false
  )
  view.unmount()
})

test('aceite legal online seguido de refreshProfile reconsulta has_app_access e libera sync/bootstrap', async () => {
  world.access = false
  const view = await onlineLogin(on, A)
  assert.equal(on.auth().serverAccessAllowed, false)
  world.access = true
  await on.auth().refreshProfile(A)
  await settle(80)
  assert.equal(on.auth().serverAccessAllowed, true)
  assert.equal(on.bootstrap.evaluateOfflineEntry(await on.bootstrap.readActiveBootstrap()).ok, true)
  view.unmount()
})

test('RECONEXÃO com OUTRA identidade na sessão (B): carrega B por completo e o bootstrap de A deixa de valer', async () => {
  const view = await coldStartOffline(A)
  await on.outbox.enqueueWorkoutMutation(A, {
    operation: 'workout.create',
    entityId: 'a1',
    payload: {
      exercise_id: 'x',
      date: '2026-10-05',
      type: 'strength',
      set_details: [{ weight: 1, reps: 1 }],
      sets: 1,
      note: '',
    },
  })
  world.online = true
  setNavigator(true)
  globalThis.__session = { user: supaUser(B), access_token: 'b', expires_at: 9e9 }
  world.refreshFails = null
  window.__fire('online')
  await settle(250)
  assert.equal(on.auth().user.uid, B)
  assert.equal(on.auth().offlineLocal, false)
  assert.equal((await on.bootstrap.readActiveBootstrap()).user_id, B)
  assert.equal((await on.outbox.listMutations(A)).length, 1) // a fila de A continua dela
  assert.equal((await on.outbox.listMutations(B)).length, 0)
  view.unmount()
})

test('RECONEXÃO: erro do SERVIDOR (não de rede) ao revalidar sai do modo offline e mostra o erro real', async () => {
  const view = await coldStartOffline()
  world.online = true
  setNavigator(true)
  globalThis.__session = { user: supaUser(A), access_token: 'novo', expires_at: 9e9 }
  world.refreshFails = null
  globalThis.__rpc = async (name) =>
    name === 'ensure_user_profile'
      ? { data: null, error: { code: '42501', message: 'permission denied' } }
      : name === 'has_app_access'
        ? { data: true, error: null }
        : { data: null, error: null }
  window.__fire('online')
  await settle(200)
  assert.equal(on.auth().offlineLocal, false) // o servidor negou: o estado online prevalece (nada de "continuar offline")
  assert.match(on.auth().profileError, /Não foi possível carregar seu perfil/)
  view.unmount()
})


// ============================================================================ cold start NÃO depende da rede

const rollout = (coldStart, extra = {}) => ({
  offline_write: { enabled: true, rollout_percentage: 100, updated_at: Date.now() },
  offline_cold_start: { enabled: coldStart, rollout_percentage: 100, updated_at: Date.now(), ...extra },
})

test('COLD START (sessão válida + navegador offline): abre direto do snapshot local, SEM nenhuma RPC/consulta de perfil, termos, acesso ou carteira', async () => {
  let view = await onlineLogin(on, A)
  view.unmount()
  world.online = false
  setNavigator(false)
  world.calls.length = 0
  view = await onlineLogin(on, A)
  const ctx = on.auth()
  assert.equal(ctx.offlineLocal, true)
  assert.equal(ctx.loading, false)
  assert.equal(ctx.user.uid, A)
  assert.deepEqual(world.calls, [], 'nada de rede no boot offline')
  view.unmount()
})

test('PRODUÇÃO: com o rollout do servidor liberando, o cold start abre offline e o snapshot é o do MESMO usuário', async () => {
  prod.setRemoteRolloutSnapshot(A, rollout(true))
  let view = await onlineLogin(prod, A)
  assert.equal((await prod.bootstrap.readActiveBootstrap())?.user_id, A, 'bootstrap gravado online')
  view.unmount()
  world.online = false
  setNavigator(false)
  world.calls.length = 0
  view = await onlineLogin(prod, A)
  assert.equal(prod.auth().offlineLocal, true)
  assert.equal(prod.auth().user.uid, A)
  assert.deepEqual(world.calls, [])
  view.unmount()
})

test('PRODUÇÃO: flag server-side DESLIGADA -> cold start não é liberado (e o erro de entrada aparece)', async () => {
  prod.setRemoteRolloutSnapshot(A, rollout(true))
  let view = await onlineLogin(prod, A)
  view.unmount()
  prod.setRemoteRolloutSnapshot(A, rollout(false, { updated_at: Date.now() + 1000 }))
  world.online = false
  setNavigator(false)
  view = await onlineLogin(prod, A)
  assert.equal(prod.auth().offlineLocal, false)
  assert.match(prod.auth().profileError, /Conecte-se à internet/)
  view.unmount()
})

test('PRODUÇÃO: sem bootstrap gravado, o cold start continua bloqueado mesmo com o rollout liberado', async () => {
  prod.setRemoteRolloutSnapshot(A, rollout(true))
  world.online = false
  setNavigator(false)
  const view = await onlineLogin(prod, A)
  assert.equal(prod.auth().offlineLocal, false)
  assert.match(prod.auth().profileError, /Conecte-se à internet/)
  view.unmount()
})

test('bootstrap de OUTRO usuário nunca abre a sessão offline de A', async () => {
  let view = await onlineLogin(on, B)
  view.unmount()
  world.online = false
  setNavigator(false)
  view = await onlineLogin(on, A)
  assert.equal(on.auth().offlineLocal, false)
  assert.notEqual(on.auth().user?.uid === B, true)
  view.unmount()
})

test('bootstrap INVÁLIDO (aceite legal adulterado/versão desconhecida) não libera o offline', async () => {
  let view = await onlineLogin(on, A)
  view.unmount()
  const record = await on.bootstrap.readActiveBootstrap()
  await on.bootstrap.saveBootstrap({
    ...record,
    legal: { ...record.legal, accepted_digest: 'f'.repeat(64) },
    last_online_verified_at: record.last_online_verified_at + 1,
    updated_at: record.updated_at + 1,
  })
  world.online = false
  setNavigator(false)
  view = await onlineLogin(on, A)
  assert.equal(on.auth().offlineLocal, false)
  view.unmount()
})

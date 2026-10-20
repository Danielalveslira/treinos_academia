import { after, afterEach, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

// Dados da Home: online grava o snapshot; offline restaura (e junta o que foi registrado offline); sem
// snapshot a atividade é "indisponível"; ao reconectar a tela não é trocada por spinner/vazio.
const require = createRequire(import.meta.url)
let directory
let api

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'home-hook-'))
  const outfile = join(directory, 'hook.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { AuthContext } from '../contexts/AuthContext.jsx'
        import { useHomeDashboard } from './useHomeDashboard.js'
        import { clearPageCache } from '../utils/pageCache.js'
        import { closeDatabase } from '../services/offline/database.js'
        import { recordWorkoutsPage } from '../services/offline/historyCache.js'
        import { saveBootstrap, buildBootstrapRecord } from '../services/offline/bootstrap.js'
        import { readOfflineEntry } from '../services/offline/bootstrapEntry.js'
        import { businessDayKey } from '../utils/businessDate.js'

        let latest = null
        function Probe() { latest = useHomeDashboard(); return null }
        export const home = () => latest
        const tree$ = (value) => createElement(AuthContext.Provider, { value }, createElement(Probe))
        export const mount = (auth) => {
          let tree
          act(() => { tree = TestRenderer.create(tree$(auth)) })
          return { update: (next) => act(() => tree.update(tree$(next))), unmount: () => act(() => tree.unmount()) }
        }
        export { act, clearPageCache, closeDatabase, recordWorkoutsPage, saveBootstrap, buildBootstrapRecord, readOfflineEntry, businessDayKey }
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
    define: {
      'import.meta.env': JSON.stringify({
        VITE_SUPABASE_URL: 'http://backend.test',
        VITE_SUPABASE_ANON_KEY: 'k',
        VITE_OFFLINE_COLD_START_ENABLED: 'true',
      }),
    },
    plugins: [
      {
        name: 'supabase-config-stub',
        setup(b) {
          b.onResolve({ filter: /\/supabase\/config$/ }, (args) => ({ path: args.path, namespace: 'stub' }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: `
              const chain = (run) => {
                const q = new Proxy({}, {
                  get: (_t, prop) => {
                    if (prop === 'then') return (res, rej) => Promise.resolve().then(run).then(res, rej)
                    return () => q
                  },
                })
                return q
              }
              export const supabase = {
                auth: { getSession: async () => ({ data: { session: null } }) },
                from: (table) => chain(() => globalThis.__from(table)),
                rpc: (name, params) => chain(() => globalThis.__rpc(name, params)),
              }
            `,
          }))
        },
      },
    ],
  })
  api = require(outfile)
})
after(async () => {
  await api.closeDatabase()
  if (directory) await rm(directory, { recursive: true, force: true })
})

const A = 'a0000000-0000-0000-0000-00000000000a'
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(check, message, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() >= deadline) assert.fail(message)
    await settle(20)
  }
}
let calls
let gate

const TODAY = () => api.businessDayKey()
const row = (id, date, extra = {}) => ({
  id,
  user_id: A,
  exercise_id: 'e1',
  type: 'strength',
  date,
  set_details: [{ weight: 50, reps: 10 }],
  sets: 1,
  duration_minutes: null,
  distance_km: null,
  note: '',
  created_at: `${date}T10:00:00.000000+00:00`,
  ...extra,
})
const serverDay = (dateKey, count, volume) => ({
  id: dateKey,
  dateKey,
  workoutCount: count,
  active: true,
  strengthVolumeKg: volume,
  strengthSets: 3,
  exerciseStats: [{ exerciseId: 'e1', workoutCount: count, maxWeightKg: 50 }],
})

beforeEach(async () => {
  await api.closeDatabase()
  globalThis.indexedDB = new IDBFactory()
  api.clearPageCache()
  calls = []
  gate = null
  globalThis.__from = async (table) => {
    calls.push(`from:${table}`)
    if (gate) await gate
    return { data: [row('w1', TODAY())], error: null }
  }
  globalThis.__rpc = async (name) => {
    calls.push(name)
    if (name === 'list_progress_days') return { data: [serverDay(TODAY(), 1, 500)], error: null }
    return { data: null, error: null }
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, userAgent: 'node' } })
})
afterEach(() => {
  delete globalThis.__from
  delete globalThis.__rpc
})

const auth = (extra = {}) => ({ user: { uid: A }, offlineLocal: false, offlineHome: null, ...extra })

async function readHome() {
  await api.saveBootstrap(
    api.buildBootstrapRecord({
      userId: A,
      profile: { id: A, username: 'a', accountStatus: 'active', trainingPreferences: null },
      emailVerified: true,
      policy: null,
      allowed: true,
    })
  )
  return (await api.readOfflineEntry()).home
}

test('ONLINE: devolve a atividade do servidor e grava o snapshot enxuto para o próximo cold start', async () => {
  const view = api.mount(auth())
  await waitFor(() => api.home().progressDays.length > 0, 'atividade online não carregou')
  const home = api.home()
  assert.equal(home.progressAvailable, true)
  assert.equal(home.progressDays[0].strengthSets, 3, 'online usa o dado completo do servidor')
  assert.equal(home.recentWorkouts.length, 1)
  const snapshot = await readHome()
  assert.equal(snapshot.progress.days.length, 1)
  assert.deepEqual(snapshot.progress.days[0], {
    dateKey: TODAY(),
    workoutCount: 1,
    strengthVolumeKg: 500,
    exerciseStats: [{ exerciseId: 'e1' }],
  })
  assert.ok(snapshot.progress.start && snapshot.progress.end)
  view.unmount()
})

async function seedLocalHistory(rows) {
  await api.recordWorkoutsPage(A, rows, { limit: 50 })
}

test('OFFLINE com snapshot: atividade restaurada do snapshot, sem nenhuma RPC', async () => {
  await seedLocalHistory([row('w1', TODAY())])
  const offlineHome = {
    user_id: A,
    progress: { start: 'a', end: 'b', saved_at: Date.now(), days: [serverDay(TODAY(), 1, 500)] },
  }
  const view = api.mount(auth({ offlineLocal: true, offlineHome }))
  await settle(80)
  const home = api.home()
  assert.equal(home.progressAvailable, true)
  assert.equal(home.progressDays.length, 1)
  assert.equal(home.progressDays[0].strengthVolumeKg, 500)
  assert.deepEqual(calls, [])
  view.unmount()
})

test('OFFLINE: o treino registrado depois do snapshot (local) passa a contar na atividade', async () => {
  const yesterday = new Date(Date.now() - 86400000)
  const savedAt = yesterday.getTime()
  const dayBefore = api.businessDayKey(yesterday)
  await seedLocalHistory([row('w0', dayBefore), row('w9', TODAY(), { set_details: [{ weight: 100, reps: 5 }] })])
  const offlineHome = {
    user_id: A,
    progress: { start: 'a', end: 'b', saved_at: savedAt, days: [serverDay(dayBefore, 1, 500)] },
  }
  const view = api.mount(auth({ offlineLocal: true, offlineHome }))
  await settle(80)
  const days = api.home().progressDays
  assert.deepEqual(days.map((d) => [d.dateKey, d.workoutCount, d.strengthVolumeKg]), [
    [dayBefore, 1, 500],
    [TODAY(), 1, 500],
  ])
  view.unmount()
})

test('OFFLINE sem snapshot de atividade: indisponível (nunca uma lista vazia que pareça "sem treinos")', async () => {
  await seedLocalHistory([row('w1', TODAY())])
  const view = api.mount(auth({ offlineLocal: true, offlineHome: null }))
  await settle(80)
  assert.equal(api.home().progressAvailable, false)
  assert.deepEqual(api.home().progressDays, [])
  assert.equal(api.home().recentWorkouts.length, 1, 'os treinos locais continuam aparecendo')
  assert.deepEqual(calls, [])
  view.unmount()
})

test('OFFLINE com snapshot de outra seção (só saldo): a atividade continua indisponível', async () => {
  await seedLocalHistory([row('w1', TODAY())])
  const view = api.mount(auth({ offlineLocal: true, offlineHome: { user_id: A, wallet: { coinBalance: 1 } } }))
  await settle(80)
  assert.equal(api.home().progressAvailable, false)
  view.unmount()
})

test('RECONEXÃO: a Home não é trocada por spinner/vazio — mostra o último dado até o servidor responder, e busca UMA vez', async () => {
  await seedLocalHistory([row('w1', TODAY())])
  const offlineHome = {
    user_id: A,
    progress: { start: 'a', end: 'b', saved_at: Date.now(), days: [serverDay(TODAY(), 1, 500)] },
  }
  const view = api.mount(auth({ offlineLocal: true, offlineHome }))
  await settle(80)
  assert.equal(api.home().recentWorkouts.length, 1)
  let release
  gate = new Promise((resolve) => {
    release = resolve
  })
  view.update(auth({ offlineLocal: false, offlineHome: null }))
  await settle(40)
  assert.equal(api.home().loading, true)
  assert.equal(api.home().recentWorkouts.length, 1, 'mantém o que já estava na tela')
  assert.equal(api.home().progressAvailable, true)
  release()
  await settle(80)
  assert.equal(api.home().loading, false)
  assert.equal(calls.filter((c) => c === 'list_progress_days').length, 1)
  assert.equal(calls.filter((c) => c === 'from:workouts').length, 1)
  view.unmount()
})

test('TROCA DE CONTA: a Home de A nunca fica na tela enquanto B carrega', async () => {
  const view = api.mount(auth())
  await settle(80)
  assert.equal(api.home().recentWorkouts.length, 1)
  let release
  gate = new Promise((resolve) => {
    release = resolve
  })
  view.update({ user: { uid: 'b0000000-0000-0000-0000-00000000000b' }, offlineLocal: false, offlineHome: null })
  await settle(40)
  assert.equal(api.home().recentWorkouts.length, 0)
  release()
  await settle(60)
  view.unmount()
})

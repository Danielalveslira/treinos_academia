// Matriz de regressão: a revogação de Web Push é BEST-EFFORT e nunca pode atrasar nem impedir
// o logout. Usa os módulos reais (useLogout, authService, pushService) sobre um Supabase e um
// navegador simulados, e registra a ORDEM das chamadas (signOut x revogação de Push).
import { after, afterEach, before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { setImmediate as waitForImmediate } from 'node:timers/promises'
import { build } from 'esbuild'

let directory
let mod
let events
let sessionAlive

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'logout-push-tests-'))
  const outfile = join(directory, 'logout.cjs')
  await build({
    stdin: {
      contents: `
        import { useLogout, LOGOUT_ALL_OTHERS_ERROR } from './useLogout.js'
        import { consumeLogoutReason } from '../utils/logoutReason.js'
        import { __reset, __render } from 'react'
        export { useLogout, LOGOUT_ALL_OTHERS_ERROR, consumeLogoutReason, __reset, __render }
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
        name: 'stubs',
        setup(ctx) {
          ctx.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
          ctx.onResolve({ filter: /supabase\/config$/ }, () => ({
            path: 'supabase',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
            contents: `
            const slots = []
            let index = 0
            export const __reset = () => { slots.length = 0; index = 0 }
            export const __render = () => { index = 0 }
            export const useRef = (value) => { const i = index++; if (!(i in slots)) slots[i] = { current: value }; return slots[i] }
            export const useState = (initial) => { const i = index++; if (!(i in slots)) slots[i] = { value: initial }; return [slots[i].value, (v) => { slots[i].value = v }] }
            export const useCallback = (fn) => fn
            export const useEffect = () => {}
          `,
          }))
          ctx.onLoad({ filter: /^supabase$/, namespace: 'stub' }, () => ({
            contents: `export const supabase = {
            auth: { onAuthStateChange: (fn) => { globalThis.__authChange = fn }, signOut: (...a) => globalThis.__signOut(...a), getSession: () => globalThis.__getSession() },
            rpc: (...a) => globalThis.__rpc(...a),
          }`,
          }))
        },
      },
    ],
  })
  mod = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device'

// rpc: 'ok' | 'fail' | 'hang' — unsubscribe: 'ok' | 'hang' — sw: 'ok' | 'none' | 'no-subscription'
function environment({
  sw = 'ok',
  rpc = 'ok',
  unsubscribe = 'ok',
  online = true,
  others = 'ok',
  local = 'ok',
} = {}) {
  events = []
  sessionAlive = true
  const subscription = {
    endpoint: ENDPOINT,
    unsubscribe: () => {
      events.push('push:unsubscribe')
      return unsubscribe === 'hang' ? new Promise(() => {}) : Promise.resolve(true)
    },
  }
  const registration =
    sw === 'ok'
      ? { pushManager: { getSubscription: async () => subscription } }
      : sw === 'no-subscription'
        ? { pushManager: { getSubscription: async () => null } }
        : undefined
  setGlobal('window', { PushManager: {}, Notification: {}, matchMedia: () => ({ matches: false }) })
  setGlobal('Notification', { permission: 'granted' })
  setGlobal('navigator', {
    onLine: online,
    userAgent: 'Android Chrome',
    platform: 'Linux',
    maxTouchPoints: 0,
    serviceWorker:
      sw === 'missing-api'
        ? undefined
        : { getRegistration: async () => registration, ready: new Promise(() => {}) },
  })
  globalThis.__rpc = (name, args) => {
    events.push(`rpc:${name}:${args.p_endpoint === null ? 'all' : 'device'}`)
    if (rpc === 'hang') return new Promise(() => {})
    if (rpc === 'fail') return Promise.resolve({ data: null, error: new Error('rpc down') })
    return Promise.resolve({ data: 0, error: null })
  }
  globalThis.__signOut = ({ scope }) => {
    events.push(`auth:${scope}`)
    if (scope === 'others' && others === 'fail')
      return Promise.resolve({ error: new Error('network') })
    if (scope === 'local') {
      if (local === 'fail') return Promise.resolve({ error: new Error('network') })
      sessionAlive = false
      globalThis.__authChange('SIGNED_OUT', null)
    }
    return Promise.resolve({ error: null })
  }
  globalThis.__getSession = () =>
    Promise.resolve({ data: { session: sessionAlive ? { access_token: 'x' } : null } })
}

let store
const originalConsole = { error: console.error, warn: console.warn }
beforeEach(() => {
  mod.__reset()
  store = new Map()
  setGlobal('sessionStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  })
  console.error = () => {}
  console.warn = () => {}
})
afterEach(() => {
  mock.timers.reset()
  console.error = originalConsole.error
  console.warn = originalConsole.warn
})

// O stub do React reaproveita os "slots" por posição: __render() reinicia o cursor, como um novo render.
function render() {
  mod.__render()
  return mod.useLogout()
}

async function run(kind) {
  const hook = render()
  await hook[kind]()
  return render()
}

// Deixa os timers simulados correrem até o fluxo terminar (sem esperar tempo real).
async function runWithClock(kind, maxMs = 12000) {
  mock.timers.enable({ apis: ['setTimeout'] })
  const hook = render()
  let done = false
  const pending = hook[kind]().finally(() => {
    done = true
  })
  for (let elapsed = 0; elapsed < maxMs && !done; elapsed += 250) {
    await waitForImmediate()
    mock.timers.tick(250)
  }
  await waitForImmediate()
  return { done, state: done ? (await pending, render()) : null }
}

test('sair deste dispositivo com Push ativo: revoga o endpoint local e encerra a sessão', async () => {
  environment()
  const state = await run('logout')
  assert.deepEqual(events, [
    'rpc:unregister_push_subscription:device',
    'push:unsubscribe',
    'auth:local',
  ])
  assert.equal(sessionAlive, false)
  assert.equal(state.error, '')
})

test('sem Service Worker: encerra a sessão sem tocar no Push', async () => {
  environment({ sw: 'none' })
  await run('logout')
  assert.deepEqual(events, ['auth:local'])
  assert.equal(sessionAlive, false)
})

test('sem API de Service Worker no navegador: encerra a sessão', async () => {
  environment({ sw: 'missing-api' })
  await run('logout')
  assert.deepEqual(events, ['auth:local'])
  assert.equal(sessionAlive, false)
})

test('sem subscription local: encerra a sessão e nunca revoga todos os dispositivos', async () => {
  environment({ sw: 'no-subscription' })
  await run('logout')
  assert.deepEqual(events, ['auth:local'])
  assert.equal(sessionAlive, false)
})

test('revogação de Push falhando NÃO impede o logout nem mostra erro', async () => {
  environment({ rpc: 'fail' })
  const state = await run('logout')
  assert.equal(sessionAlive, false)
  assert.equal(state.error, '')
  assert.ok(events.includes('auth:local'))
})

test('revogação de Push TRAVADA não atrasa o logout além de ~3s', async () => {
  environment({ rpc: 'hang' })
  const { done } = await runWithClock('logout', 3000)
  assert.equal(done, true, 'logout deve terminar em até 3s mesmo com o Push travado')
  assert.equal(sessionAlive, false)
})

test('unsubscribe local travado (bug conhecido de navegadores) não atrasa o logout além de ~3s', async () => {
  environment({ unsubscribe: 'hang' })
  const { done } = await runWithClock('logout', 3000)
  assert.equal(done, true, 'logout deve terminar em até 3s mesmo com o unsubscribe travado')
  assert.equal(sessionAlive, false)
})

test('offline: não tenta revogar Push (não há como) e encerra a sessão local', async () => {
  environment({ online: false })
  await run('logout')
  assert.deepEqual(events, ['auth:local'])
  assert.equal(sessionAlive, false)
})

test('sair de todos: revoga as OUTRAS sessões primeiro, depois o Push e por último esta sessão', async () => {
  environment()
  const state = await run('logoutAll')
  assert.deepEqual(events, [
    'auth:others',
    'rpc:unregister_push_subscription:all',
    'push:unsubscribe',
    'auth:local',
  ])
  assert.equal(sessionAlive, false)
  assert.equal(state.error, '')
  assert.equal(mod.consumeLogoutReason().message.length > 0, true)
})

test('sair de todos: se revogar as outras sessões falha, NADA mais é tocado (sessão e Push intactos)', async () => {
  environment({ others: 'fail' })
  const state = await run('logoutAll')
  assert.deepEqual(events, ['auth:others'])
  assert.equal(sessionAlive, true)
  assert.equal(state.error, mod.LOGOUT_ALL_OTHERS_ERROR)
})

test('sair de todos: revogação de Push falhando não impede o logout', async () => {
  environment({ rpc: 'fail' })
  const state = await run('logoutAll')
  assert.equal(sessionAlive, false)
  assert.equal(state.error, '')
  assert.deepEqual(
    events.filter((e) => e.startsWith('auth:')),
    ['auth:others', 'auth:local']
  )
})

test('sair de todos: Push travado não atrasa o logout além de ~3s', async () => {
  environment({ rpc: 'hang' })
  const { done, state } = await runWithClock('logoutAll', 3000)
  assert.equal(done, true, 'logout global deve terminar em até 3s mesmo com o Push travado')
  assert.equal(sessionAlive, false)
  assert.equal(state.error, '')
})

test('sair de todos sem Service Worker nem subscription', async () => {
  environment({ sw: 'none' })
  await run('logoutAll')
  // Sem Service Worker local ainda revoga os dispositivos da conta no servidor (rpc), depois sai.
  assert.deepEqual(events, ['auth:others', 'rpc:unregister_push_subscription:all', 'auth:local'])
  assert.equal(sessionAlive, false)
})

test('sair de todos offline: falha na etapa 1, continua logado e sem efeitos no Push', async () => {
  environment({ online: false, others: 'fail' })
  const state = await run('logoutAll')
  assert.equal(sessionAlive, true)
  assert.deepEqual(events, ['auth:others'])
  assert.equal(state.error, mod.LOGOUT_ALL_OTHERS_ERROR)
})

import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let mod
let rpcCalls
let rpcResult

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'push-service-tests-'))
  const outfile = join(directory, 'push-service.cjs')
  await build({
    entryPoints: [new URL('./pushService.js', import.meta.url).pathname],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    define: { 'import.meta.env.VITE_VAPID_PUBLIC_KEY': 'globalThis.__vapidKey' },
    plugins: [{
      name: 'stubs',
      setup(ctx) {
        ctx.onResolve({ filter: /supabase\/config$/ }, () => ({ path: 'supabase', namespace: 'stub' }))
        ctx.onLoad({ filter: /^supabase$/, namespace: 'stub' }, () => ({
          contents: 'export const supabase = { rpc: (...a) => globalThis.__rpc(...a) }',
        }))
      },
    }],
  })
  mod = createRequire(import.meta.url)(outfile)
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

function browser({ registration, permission = 'granted', userAgent = 'Android Chrome', standalone = false, ready } = {}) {
  const notification = { permission, requestPermission: async () => { globalThis.__prompted = true; return permission } }
  setGlobal('Notification', notification)
  setGlobal('window', { PushManager: {}, Notification: notification, matchMedia: () => ({ matches: standalone }) })
  setGlobal('navigator', {
    userAgent,
    platform: 'Linux',
    maxTouchPoints: 0,
    // `ready` nunca resolve sem Service Worker: o código não pode depender dele para logout/sync.
    serviceWorker: { getRegistration: async () => registration, ready: ready || new Promise(() => {}) },
  })
}

function fakeRegistration(endpoint) {
  const state = { unsubscribed: 0 }
  const subscription = endpoint && {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p'.repeat(32), auth: 'a'.repeat(16) } }),
    unsubscribe: async () => { state.unsubscribed += 1; return true },
  }
  return { state, pushManager: { getSubscription: async () => subscription || null } }
}

beforeEach(() => {
  rpcCalls = []
  rpcResult = { data: null, error: null }
  globalThis.__rpc = async (name, args) => { rpcCalls.push([name, args]); return rpcResult }
  globalThis.__vapidKey = 'AQAB'
  globalThis.__prompted = false
})

test('desativar sem subscription local não revoga nenhum dispositivo', async () => {
  browser({ registration: fakeRegistration(null) })
  await mod.disablePushNotifications()
  assert.deepEqual(rpcCalls, [])
})

test('desativar sem Service Worker não trava nem chama o servidor', async () => {
  browser({ registration: undefined })
  await mod.disablePushNotifications()
  assert.deepEqual(rpcCalls, [])
})

test('desativar revoga apenas o endpoint local e encerra a subscription', async () => {
  const registration = fakeRegistration('https://fcm.googleapis.com/fcm/send/local')
  browser({ registration })
  await mod.disablePushNotifications()
  assert.deepEqual(rpcCalls, [['unregister_push_subscription', { p_endpoint: 'https://fcm.googleapis.com/fcm/send/local' }]])
  assert.equal(registration.state.unsubscribed, 1)
})

test('logout global revoga todos os dispositivos mesmo sem subscription local', async () => {
  browser({ registration: undefined })
  await mod.disablePushNotifications({ allDevices: true })
  assert.deepEqual(rpcCalls, [['unregister_push_subscription', { p_endpoint: null }]])
})

test('falha ao revogar no servidor ainda encerra a subscription local e propaga o erro', async () => {
  const registration = fakeRegistration('https://fcm.googleapis.com/fcm/send/local')
  browser({ registration })
  rpcResult = { data: null, error: new Error('offline') }
  await assert.rejects(mod.disablePushNotifications(), /offline/)
  assert.equal(registration.state.unsubscribed, 1)
})

test('sync não cria subscription nem pede permissão e não trava sem Service Worker', async () => {
  browser({ registration: undefined })
  assert.equal(await mod.syncPushSubscription(), null)
  browser({ registration: fakeRegistration(null) })
  assert.equal(await mod.syncPushSubscription(), null)
  browser({ registration: fakeRegistration('https://fcm.googleapis.com/fcm/send/local'), permission: 'default' })
  assert.equal(await mod.syncPushSubscription(), null)
  assert.equal(globalThis.__prompted, false)
  assert.deepEqual(rpcCalls, [])
})

test('sync renova o registro da subscription existente', async () => {
  browser({ registration: fakeRegistration('https://fcm.googleapis.com/fcm/send/local') })
  await mod.syncPushSubscription()
  assert.equal(rpcCalls[0][0], 'register_push_subscription')
  assert.equal(rpcCalls[0][1].p_endpoint, 'https://fcm.googleapis.com/fcm/send/local')
})

test('ativar não pede permissão sem VAPID configurado nem sem Service Worker', async () => {
  browser({ registration: fakeRegistration(null) })
  globalThis.__vapidKey = undefined
  await assert.rejects(mod.enablePushNotifications(), { code: 'vapid-not-configured' })
  globalThis.__vapidKey = 'AQAB'
  browser({ registration: undefined })
  await assert.rejects(mod.enablePushNotifications(), { code: 'service-worker-unavailable' })
  assert.equal(globalThis.__prompted, false)
})

test('iOS fora da Tela de Início não oferece Push; instalado oferece', () => {
  browser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })
  assert.deepEqual(mod.pushSupport(), { supported: false, reason: 'ios-install-required' })
  browser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', standalone: true })
  assert.equal(mod.pushSupport().supported, true)
})

test('status consulta o endpoint local', async () => {
  rpcResult = { data: { thisDevice: true }, error: null }
  assert.deepEqual(await mod.getPushStatus('https://fcm.googleapis.com/fcm/send/local'), { thisDevice: true })
  assert.deepEqual(rpcCalls[0], ['get_my_push_status', { p_endpoint: 'https://fcm.googleapis.com/fcm/send/local' }])
})

// ---- ativação: etapas, erro exato e confirmação do endpoint no backend --------------------------
const VAPID = 'BAQAAQ' // base64url qualquer válido para decodificar

function activatable({ subscribe, status = { thisDevice: true }, register = { data: 'id', error: null } } = {}) {
  const created = { endpoint: 'https://fcm.googleapis.com/fcm/send/new', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'p'.repeat(32), auth: 'a'.repeat(16) } }), unsubscribe: async () => true }
  const registration = {
    pushManager: {
      getSubscription: async () => null,
      subscribe: subscribe || (async () => created),
    },
  }
  browser({ registration, ready: Promise.resolve(registration) })
  globalThis.__vapidKey = VAPID
  globalThis.__rpc = async (name, args) => {
    rpcCalls.push([name, args])
    if (name === 'register_push_subscription') return register
    if (name === 'get_my_push_status') return status instanceof Error ? { data: null, error: status } : { data: status, error: null }
    return { data: null, error: null }
  }
  return created
}

test('ativar: cria a subscription local, registra e só conclui com o endpoint ativo no backend', async () => {
  const created = activatable()
  const result = await mod.enablePushNotifications()
  assert.equal(result.permission, 'granted')
  assert.equal(result.subscription.endpoint, created.endpoint)
  assert.deepEqual(rpcCalls.map(([name]) => name), ['register_push_subscription', 'get_my_push_status'])
  assert.equal(rpcCalls[1][1].p_endpoint, created.endpoint)
})

test('ativar: backend que NÃO devolve este endpoint como ativo falha na etapa confirm', async () => {
  activatable({ status: { thisDevice: false, activeSubscriptions: 1 } })
  await assert.rejects(mod.enablePushNotifications(), (error) => error.code === 'push-not-confirmed' && error.stage === 'confirm')
})

test('ativar: RPC de status inexistente (404/PGRST202) vira erro exato na etapa confirm, não genérico', async () => {
  activatable({ status: Object.assign(new Error('Could not find the function public.get_my_push_status(p_endpoint) in the schema cache'), { code: 'PGRST202' }) })
  let caught
  try { await mod.enablePushNotifications() } catch (error) { caught = error }
  assert.equal(caught.stage, 'confirm')
  assert.match(mod.describePushError(caught), /^confirm · PGRST202 · Could not find the function/)
})

test('ativar: falha do pushManager.subscribe informa a etapa e o nome do erro', async () => {
  activatable({ subscribe: async () => { throw Object.assign(new Error('Registration failed - push service error'), { name: 'AbortError' }) } })
  let caught
  try { await mod.enablePushNotifications() } catch (error) { caught = error }
  assert.equal(caught.stage, 'subscribe')
  assert.match(mod.describePushError(caught), /^subscribe · AbortError · Registration failed/)
})

test('ativar: falha ao registrar no backend informa a etapa register', async () => {
  activatable({ register: { data: null, error: Object.assign(new Error('INVALID_SUBSCRIPTION'), { code: 'P0001' }) } })
  await assert.rejects(mod.enablePushNotifications(), (error) => error.stage === 'register')
})

test('describePushError nunca expõe endpoints e limita o tamanho', () => {
  const text = mod.describePushError(Object.assign(new Error(`falhou em https://fcm.googleapis.com/fcm/send/segredo ${'x'.repeat(400)}`), { stage: 'register' }))
  assert.equal(text.includes('segredo'), false)
  assert.ok(text.includes('[url]'))
  assert.ok(text.length < 220)
})

test('estado local: browser e PWA são contextos separados (endpoint local decide, não a conta)', async () => {
  rpcResult = { data: { thisDevice: false, activeSubscriptions: 2 }, error: null }
  // contexto A (ex.: navegador) com subscription própria; contexto B (ex.: PWA) sem nenhuma
  browser({ registration: fakeRegistration('https://fcm.googleapis.com/fcm/send/browser') })
  const a = await mod.getLocalPushState()
  browser({ registration: fakeRegistration(null) })
  const b = await mod.getLocalPushState()
  assert.equal(a.endpoint, 'https://fcm.googleapis.com/fcm/send/browser')
  assert.equal(b.endpoint, null)
  // a conta tem 2 dispositivos ativos, mas o backend informa thisDevice=false para o contexto B
  assert.equal((await mod.getPushStatus(b.endpoint)).thisDevice, false)
})

test('estado local sem suporte (iOS fora da Tela de Início) não consulta nada', async () => {
  browser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', registration: fakeRegistration('https://web.push.apple.com/x') })
  const state = await mod.getLocalPushState()
  assert.equal(state.support.reason, 'ios-install-required')
  assert.equal(state.endpoint, null)
  assert.deepEqual(rpcCalls, [])
})

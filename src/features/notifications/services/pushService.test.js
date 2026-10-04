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

function browser({ registration, permission = 'granted', userAgent = 'Android Chrome', standalone = false } = {}) {
  const notification = { permission, requestPermission: async () => { globalThis.__prompted = true; return permission } }
  setGlobal('Notification', notification)
  setGlobal('window', { PushManager: {}, Notification: notification, matchMedia: () => ({ matches: standalone }) })
  setGlobal('navigator', {
    userAgent,
    platform: 'Linux',
    maxTouchPoints: 0,
    // `ready` nunca resolve sem Service Worker: o código não pode depender dele para logout/sync.
    serviceWorker: { getRegistration: async () => registration, ready: new Promise(() => {}) },
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

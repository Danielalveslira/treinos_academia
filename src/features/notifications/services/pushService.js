import { supabase } from '../../../supabase/config'

export function isStandalone() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
}

export function isIosDevice() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function pushSupport() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { supported: false, reason: 'unsupported' }
  const apiAvailable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!apiAvailable) return { supported: false, reason: 'unsupported' }
  if (isIosDevice() && !isStandalone()) return { supported: false, reason: 'ios-install-required' }
  return { supported: true, reason: null }
}

export function decodeVapidPublicKey(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

function subscriptionParams(subscription) {
  const json = subscription.toJSON()
  return {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: navigator.userAgent,
    p_device_label: navigator.platform || null,
    p_platform: isIosDevice() ? 'ios' : navigator.userAgentData?.platform || navigator.platform || null,
  }
}

const SERVICE_WORKER_TIMEOUT_MS = 10000
const REVOKE_TIMEOUT_MS = 5000

function withTimeout(promise, ms, code) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// `serviceWorker.ready` nunca resolve quando não há Service Worker registrado (dev, registro
// falhou): usar `getRegistration()` evita travar logout/sync nesse caso.
async function currentRegistration() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) || null
}

export async function getLocalPushEndpoint() {
  const registration = await currentRegistration()
  const subscription = registration ? await registration.pushManager.getSubscription() : null
  return subscription?.endpoint || null
}

function sameApplicationServerKey(subscription, expected) {
  const current = subscription.options?.applicationServerKey
  if (!current) return true
  const bytes = new Uint8Array(current)
  return bytes.length === expected.length && bytes.every((value, index) => value === expected[index])
}

async function registerSubscription(subscription) {
  const { error } = await supabase.rpc('register_push_subscription', subscriptionParams(subscription))
  if (error) throw error
  return subscription
}

export async function enablePushNotifications() {
  const support = pushSupport()
  if (!support.supported) throw Object.assign(new Error(support.reason), { code: support.reason })
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!publicKey) throw Object.assign(new Error('VAPID_NOT_CONFIGURED'), { code: 'vapid-not-configured' })
  if (!(await currentRegistration())) {
    throw Object.assign(new Error('SERVICE_WORKER_UNAVAILABLE'), { code: 'service-worker-unavailable' })
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { permission, subscription: null }
  const registration = await withTimeout(navigator.serviceWorker.ready, SERVICE_WORKER_TIMEOUT_MS, 'service-worker-unavailable')
  const applicationServerKey = decodeVapidPublicKey(publicKey)
  let subscription = await registration.pushManager.getSubscription()
  // Chave VAPID trocada: a subscription antiga seria recusada pelo provedor.
  if (subscription && !sameApplicationServerKey(subscription, applicationServerKey)) {
    await subscription.unsubscribe()
    subscription = null
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
  }
  await registerSubscription(subscription)
  return { permission, subscription }
}

// Renova o vínculo da subscription local com a conta atual (sem criar subscription nova).
export async function syncPushSubscription() {
  if (!pushSupport().supported || Notification.permission !== 'granted') return null
  const registration = await currentRegistration()
  const subscription = registration ? await registration.pushManager.getSubscription() : null
  return subscription ? registerSubscription(subscription) : null
}

async function revokePush({ allDevices }) {
  const registration = await currentRegistration()
  const subscription = registration ? await registration.pushManager.getSubscription() : null
  // Sem subscription local não há o que revogar neste dispositivo: nunca cair em
  // `p_endpoint = null`, que revogaria todos os dispositivos da conta.
  if (!allDevices && !subscription) return
  let failure = null
  try {
    const { error } = await supabase.rpc('unregister_push_subscription', {
      p_endpoint: allDevices ? null : subscription.endpoint,
    })
    if (error) failure = error
  } catch (error) {
    failure = error
  }
  // Mesmo com a revogação no servidor falhando (offline), encerra a subscription local: o provedor
  // passa a responder 410 e o worker a revoga na próxima entrega.
  await subscription?.unsubscribe().catch(() => {})
  if (failure) throw failure
}

export function disablePushNotifications({ allDevices = false } = {}) {
  return withTimeout(revokePush({ allDevices }), REVOKE_TIMEOUT_MS, 'push-revoke-timeout')
}

export async function getPushStatus(endpoint = null) {
  const { data, error } = await supabase.rpc('get_my_push_status', { p_endpoint: endpoint })
  if (error) throw error
  return data
}

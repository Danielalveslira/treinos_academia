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

// Etapa onde a ativação falhou (permission, service-worker, subscribe, register, confirm): o erro
// real nunca vira só "não foi possível" -- a UI mostra `describePushError`.
function stageError(stage, error) {
  const wrapped = error instanceof Error ? error : new Error(String(error))
  if (!wrapped.stage) wrapped.stage = stage
  return wrapped
}

async function step(stage, task) {
  try {
    return await task()
  } catch (error) {
    throw stageError(stage, error)
  }
}

// Texto técnico seguro para exibir/logar: etapa, código/nome e mensagem, sem URLs (o endpoint da
// subscription é sensível) e com tamanho limitado.
export function describePushError(error) {
  if (!error) return ''
  const label = error.code || error.name || 'Error'
  const message = String(error.message || '').replace(/https?:\/\/\S+/g, '[url]').slice(0, 160)
  return [error.stage, label, message].filter(Boolean).join(' · ')
}

// "Desativei Push neste dispositivo" é uma escolha EXPLÍCITA do usuário, guardada por conta no
// armazenamento local. O logout também revoga a subscription, mas isso NÃO é uma escolha: no próximo
// login o dispositivo volta a se inscrever sozinho (a permissão do navegador já está concedida, então
// não há novo prompt). Sem isso, cada logout/login deixava a conta sem Push até alguém tocar em Ativar.
const optOutKey = (userId) => `evolutus:push-optout:${userId}`

export function isPushOptedOut(userId) {
  if (!userId) return false
  try {
    return globalThis.localStorage?.getItem(optOutKey(userId)) === '1'
  } catch {
    return false
  }
}

function setPushOptOut(userId, value) {
  if (!userId) return
  try {
    if (value) globalThis.localStorage?.setItem(optOutKey(userId), '1')
    else globalThis.localStorage?.removeItem(optOutKey(userId))
  } catch {
    // sem armazenamento: o comportamento padrão (reinscrever) continua válido
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

// Estado DESTE dispositivo/contexto (navegador ou PWA instalado): permissão, Service Worker e
// subscription locais. Nunca inferido da conta: browser e PWA podem ter subscriptions distintas
// (no iOS, o app da Tela de Início tem armazenamento próprio; no Chrome/Android compartilham).
export async function getLocalPushState() {
  const support = pushSupport()
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  if (!support.supported) return { support, permission, endpoint: null, standalone: isStandalone() }
  let endpoint = null
  try {
    endpoint = await getLocalPushEndpoint()
  } catch {
    endpoint = null
  }
  return { support, permission, endpoint, standalone: isStandalone() }
}

export async function enablePushNotifications({ userId = null } = {}) {
  const support = pushSupport()
  if (!support.supported) throw Object.assign(new Error(support.reason), { code: support.reason, stage: 'support' })
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!publicKey) throw Object.assign(new Error('VAPID_NOT_CONFIGURED'), { code: 'vapid-not-configured', stage: 'config' })
  if (!(await currentRegistration())) {
    throw Object.assign(new Error('SERVICE_WORKER_UNAVAILABLE'), { code: 'service-worker-unavailable', stage: 'service-worker' })
  }
  const permission = await step('permission', () => Notification.requestPermission())
  if (permission !== 'granted') return { permission, subscription: null, status: null }
  const registration = await step('service-worker', () =>
    withTimeout(navigator.serviceWorker.ready, SERVICE_WORKER_TIMEOUT_MS, 'service-worker-unavailable'))
  const applicationServerKey = decodeVapidPublicKey(publicKey)
  let subscription = await step('subscribe', () => registration.pushManager.getSubscription())
  // Chave VAPID trocada: a subscription antiga seria recusada pelo provedor.
  if (subscription && !sameApplicationServerKey(subscription, applicationServerKey)) {
    await step('subscribe', () => subscription.unsubscribe())
    subscription = null
  }
  if (!subscription) {
    subscription = await step('subscribe', () =>
      registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }))
  }
  await step('register', () => registerSubscription(subscription))
  setPushOptOut(userId, false)
  // Só considera ativo quando o backend devolve ESTE endpoint como ativo para o usuário atual.
  const status = await step('confirm', () => getPushStatus(subscription.endpoint))
  if (!status?.thisDevice) {
    throw stageError('confirm', Object.assign(new Error('ENDPOINT_NOT_ACTIVE'), { code: 'push-not-confirmed' }))
  }
  return { permission, subscription, status }
}

// Renova o vínculo da subscription local com a conta atual. Se a permissão já está concedida e este
// dispositivo não tem subscription (logout revogou, navegador a descartou), recria -- sem prompt --
// a menos que o usuário tenha desativado o Push aqui de propósito.
export async function syncPushSubscription({ userId = null } = {}) {
  if (!pushSupport().supported || Notification.permission !== 'granted') return null
  if (isPushOptedOut(userId)) return null
  const registration = await currentRegistration()
  if (!registration) return null
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    if (!publicKey) return null
    const ready = await withTimeout(navigator.serviceWorker.ready, SERVICE_WORKER_TIMEOUT_MS, 'service-worker-unavailable')
    subscription = await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidPublicKey(publicKey),
    })
  }
  return registerSubscription(subscription)
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

// `explicit` (+ userId): o usuário escolheu desativar neste dispositivo -- guarda a escolha para o
// sync não reinscrever. Logout chama sem `explicit` (não é uma escolha).
export function disablePushNotifications({ allDevices = false, explicit = false, userId = null } = {}) {
  if (explicit) setPushOptOut(userId, true)
  return withTimeout(revokePush({ allDevices }), REVOKE_TIMEOUT_MS, 'push-revoke-timeout')
}

export async function getPushStatus(endpoint = null) {
  const { data, error } = await supabase.rpc('get_my_push_status', { p_endpoint: endpoint })
  if (error) throw error
  return data
}

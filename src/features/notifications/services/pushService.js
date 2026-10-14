import { supabase } from '../../../supabase/config'

export function isStandalone() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
}

export function isIosDevice() {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function pushSupport() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined')
    return { supported: false, reason: 'unsupported' }
  if (isIosDevice() && !isStandalone()) return { supported: false, reason: 'ios-install-required' }
  const apiAvailable =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!apiAvailable) return { supported: false, reason: 'unsupported' }
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
    p_platform: isIosDevice()
      ? 'ios'
      : navigator.userAgentData?.platform || navigator.platform || null,
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
    return await withTimeout(task(), SERVICE_WORKER_TIMEOUT_MS, 'push-operation-timeout')
  } catch (error) {
    throw stageError(stage, error)
  }
}

// Texto técnico seguro para exibir/logar: etapa, código/nome e mensagem, sem URLs (o endpoint da
// subscription é sensível) e com tamanho limitado.
export function describePushError(error) {
  if (!error) return ''
  const label = error.code || error.name || 'Error'
  const message = String(error.message || '')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .slice(0, 160)
  return [error.stage, label, message].filter(Boolean).join(' · ')
}

// "Desativei Push neste dispositivo" é uma escolha EXPLÍCITA do usuário, guardada por conta no
// armazenamento local. O logout também revoga a subscription, mas isso NÃO é uma escolha: no próximo
// login o dispositivo volta a se inscrever sozinho (a permissão do navegador já está concedida, então
// não há novo prompt). Sem isso, cada logout/login deixava a conta sem Push até alguém tocar em Ativar.
const optOutKey = (userId) => `evolutus:push-optout:${userId}`

const memoryOptOut = new Map()
const volatileOptOut = new Set()

export function isPushOptedOut(userId) {
  if (!userId) return false
  try {
    const storage = globalThis.localStorage
    return !storage || volatileOptOut.has(userId)
      ? memoryOptOut.get(userId) === true
      : storage.getItem(optOutKey(userId)) === '1'
  } catch {
    return memoryOptOut.get(userId) === true
  }
}

function setPushOptOut(userId, value) {
  if (!userId) return
  memoryOptOut.set(userId, value)
  try {
    if (!globalThis.localStorage) {
      volatileOptOut.add(userId)
      return
    }
    if (value) globalThis.localStorage?.setItem(optOutKey(userId), '1')
    else globalThis.localStorage?.removeItem(optOutKey(userId))
    volatileOptOut.delete(userId)
  } catch {
    volatileOptOut.add(userId)
    // A escolha permanece no fallback em memória nesta sessão.
  }
}

const SERVICE_WORKER_TIMEOUT_MS = 10000
const REVOKE_TIMEOUT_MS = 5000

function abortable(promise, signal) {
  let onAbort
  const aborted = new Promise((_, reject) => {
    onAbort = () =>
      reject(Object.assign(new Error('PUSH_CONTEXT_CHANGED'), { code: 'push-context-changed' }))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([promise, aborted]).finally(() =>
    signal.removeEventListener('abort', onAbort)
  )
}

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
  return (
    (await withTimeout(
      navigator.serviceWorker.getRegistration(),
      SERVICE_WORKER_TIMEOUT_MS,
      'service-worker-unavailable'
    )) || null
  )
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
  return (
    bytes.length === expected.length && bytes.every((value, index) => value === expected[index])
  )
}

const rpcControllers = new Set()
async function pushRpc(name, args) {
  const controller = new AbortController()
  rpcControllers.add(controller)
  try {
    const request = supabase.rpc(name, args)
    return await withTimeout(
      abortable(
        request.abortSignal ? request.abortSignal(controller.signal) : request,
        controller.signal
      ),
      SERVICE_WORKER_TIMEOUT_MS,
      'push-network-timeout'
    )
  } finally {
    controller.abort()
    rpcControllers.delete(controller)
  }
}

async function registerSubscription(subscription) {
  const { error } = await pushRpc('register_push_subscription', subscriptionParams(subscription))
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

// One mutation queue for the browser's single subscription. Invalidate immediately on logout,
// disable or auth change; a delayed operation must never bind an endpoint to the next account.
let revision = 0
let mutation = Promise.resolve()
let operationController = new AbortController()
let enabling = null
let reading = null
let cachedDevice = null
let preparedRegistration
const listeners = new Set()

export function subscribePushChanges(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function changed() {
  cachedDevice = null
  for (const listener of listeners) listener()
}
export function invalidatePushOperations() {
  revision += 1
  operationController.abort()
  operationController = new AbortController()
  for (const controller of rpcControllers) controller.abort()
  preparedRegistration = undefined
  changed()
}
let authenticatedUser
supabase.auth?.onAuthStateChange((event, session) => {
  const userId = session?.user?.id || null
  if (authenticatedUser !== userId || event === 'SIGNED_OUT') invalidatePushOperations()
  authenticatedUser = userId
})

function enqueue(task) {
  const signal = operationController.signal
  const result = mutation.then(() => {
    if (signal.aborted)
      throw Object.assign(new Error('PUSH_CONTEXT_CHANGED'), { code: 'push-context-changed' })
    return abortable(task(), signal)
  })
  mutation = result.catch(() => {})
  return result
}
async function assertIdentity(userId, generation) {
  if (generation !== revision || globalThis.navigator?.onLine === false) {
    throw Object.assign(new Error('PUSH_CONTEXT_CHANGED'), { code: 'push-context-changed' })
  }
  if (userId) {
    const { data, error } = await supabase.auth.getSession()
    if (error || data?.session?.user?.id !== userId || generation !== revision) {
      throw Object.assign(new Error('PUSH_CONTEXT_CHANGED'), { code: 'push-context-changed' })
    }
  }
}

// A synchronous snapshot avoids reserving a card again after activation in the Profile.
export function getCachedPushDevice(userId) {
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  if (
    cachedDevice &&
    cachedDevice.userId === userId &&
    cachedDevice.value.permission === permission &&
    Date.now() - cachedDevice.at < 30 * 60 * 1000
  )
    return cachedDevice.value
  return null
}

// Preparation does not authorize, subscribe or query the server.
export async function preparePushNotifications() {
  if (!pushSupport().supported) return null
  try {
    preparedRegistration = await withTimeout(
      currentRegistration(),
      SERVICE_WORKER_TIMEOUT_MS,
      'service-worker-unavailable'
    )
    return preparedRegistration
  } catch {
    return null
  }
}

export function isDevicePushActive(local, status) {
  return (
    local.support.supported &&
    local.permission === 'granted' &&
    Boolean(local.endpoint) &&
    status?.thisDevice === true &&
    status?.enabled === true
  )
}

export function enablePushNotifications({ userId = null } = {}) {
  if (enabling?.userId === userId) return enabling.promise
  const generation = revision
  // Everything up to requestPermission is synchronous: preserve the trusted click gesture.
  let permissionResult
  try {
    const support = pushSupport()
    if (!support.supported)
      throw Object.assign(new Error(support.reason), { code: support.reason, stage: 'support' })
    if (globalThis.navigator?.onLine === false) throw new Error('OFFLINE')
    if (!import.meta.env.VITE_VAPID_PUBLIC_KEY)
      throw Object.assign(new Error('VAPID_NOT_CONFIGURED'), {
        code: 'vapid-not-configured',
        stage: 'config',
      })
    if (preparedRegistration === null)
      throw Object.assign(new Error('SERVICE_WORKER_UNAVAILABLE'), {
        code: 'service-worker-unavailable',
        stage: 'service-worker',
      })
    permissionResult =
      Notification.permission === 'default'
        ? Notification.requestPermission()
        : Notification.permission
  } catch (error) {
    return Promise.reject(stageError(error.stage || 'permission', error))
  }
  // Attach a rejection handler immediately, even if another mutation is still in flight.
  const permissionPromise = Promise.resolve(permissionResult).then(
    (permission) => ({ permission }),
    (error) => ({ error: stageError('permission', error) })
  )
  const promise = enqueue(async () => {
    const outcome = await permissionPromise
    if (outcome.error) throw outcome.error
    const permission = outcome.permission
    if (permission !== 'granted') return { permission, subscription: null, status: null }
    await assertIdentity(userId, generation)
    const registration = await step('service-worker', async () => {
      if (!(await currentRegistration()))
        throw Object.assign(new Error('SERVICE_WORKER_UNAVAILABLE'), {
          code: 'service-worker-unavailable',
        })
      return withTimeout(
        navigator.serviceWorker.ready,
        SERVICE_WORKER_TIMEOUT_MS,
        'service-worker-unavailable'
      )
    })
    await assertIdentity(userId, generation)
    const applicationServerKey = decodeVapidPublicKey(import.meta.env.VITE_VAPID_PUBLIC_KEY)
    let subscription = await step('subscribe', () => registration.pushManager.getSubscription())
    if (subscription && !sameApplicationServerKey(subscription, applicationServerKey)) {
      await step('subscribe', () => subscription.unsubscribe())
      subscription = null
    }
    await assertIdentity(userId, generation)
    if (!subscription)
      subscription = await step('subscribe', () =>
        registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
      )
    await assertIdentity(userId, generation)
    await step('register', () => registerSubscription(subscription))
    await assertIdentity(userId, generation)
    const status = await step('confirm', () => getPushStatus(subscription.endpoint))
    await assertIdentity(userId, generation)
    if (status?.thisDevice !== true || status?.enabled !== true) {
      throw stageError(
        'confirm',
        Object.assign(new Error('ENDPOINT_NOT_ACTIVE'), {
          code: status?.enabled === false ? 'push-preference-disabled' : 'push-not-confirmed',
        })
      )
    }
    setPushOptOut(userId, false)
    cachedDevice = {
      userId,
      at: Date.now(),
      value: { support: pushSupport(), permission, endpoint: subscription.endpoint, status },
    }
    for (const listener of listeners) listener()
    return { permission, subscription, status }
  })
  enabling = { userId, promise }
  promise
    .finally(() => {
      if (enabling?.promise === promise) enabling = null
    })
    .catch(() => {})
  return promise
}

// Shared, bounded cache and in-flight read for Layout, Home and Profile. Default/denied never
// reach an RPC. Reconciliation only runs under an already granted permission and enabled preference.
export function readPushDevice({ userId = null, refresh = false } = {}) {
  if (reading?.userId === userId && reading.generation === revision) return reading.promise
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  if (
    !refresh &&
    cachedDevice &&
    cachedDevice.userId === userId &&
    cachedDevice.value.permission === permission &&
    Date.now() - cachedDevice.at < 30 * 60 * 1000
  ) {
    const entry = cachedDevice
    return getLocalPushState().then((local) => {
      if (
        entry === cachedDevice &&
        local.endpoint === entry.value.endpoint &&
        local.support.reason === entry.value.support.reason
      )
        return { ...entry.value, ...local }
      return readPushDevice({ userId, refresh: true })
    })
  }
  const generation = revision
  const promise = enqueue(async () => {
    const local = await getLocalPushState()
    if (!local.support.supported || local.permission !== 'granted' || isPushOptedOut(userId))
      return { ...local, status: null }
    await assertIdentity(userId, generation)
    const registration = await currentRegistration()
    if (!registration) return { ...local, status: null }
    const existing = await registration.pushManager.getSubscription()
    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    if (!existing && !publicKey) return { ...local, status: null }
    if (
      existing &&
      publicKey &&
      !sameApplicationServerKey(existing, decodeVapidPublicKey(publicKey))
    )
      local.endpoint = null
    let status = await getPushStatus(local.endpoint)
    await assertIdentity(userId, generation)
    if (status?.enabled === true && !status.thisDevice) {
      const registration = await currentRegistration()
      if (registration) {
        const key = import.meta.env.VITE_VAPID_PUBLIC_KEY
        let subscription = await registration.pushManager.getSubscription()
        if (
          subscription &&
          key &&
          !sameApplicationServerKey(subscription, decodeVapidPublicKey(key))
        ) {
          // Rotation needs the explicit activation flow; never treat an incompatible key as active.
          return { ...local, endpoint: null, status }
        }
        await assertIdentity(userId, generation)
        if (!subscription && key) {
          const ready = await withTimeout(
            navigator.serviceWorker.ready,
            SERVICE_WORKER_TIMEOUT_MS,
            'service-worker-unavailable'
          )
          await assertIdentity(userId, generation)
          subscription = await ready.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: decodeVapidPublicKey(key),
          })
        }
        if (subscription) {
          await assertIdentity(userId, generation)
          await registerSubscription(subscription)
          await assertIdentity(userId, generation)
          local.endpoint = subscription.endpoint
          status = await getPushStatus(local.endpoint)
          await assertIdentity(userId, generation)
        }
      }
    }
    return { ...local, status }
  }).then((value) => {
    if (generation === revision) cachedDevice = { userId, value, at: Date.now() }
    return value
  })
  reading = { userId, generation, promise }
  promise
    .finally(() => {
      if (reading?.promise === promise) reading = null
    })
    .catch(() => {})
  return promise
}

export async function syncPushSubscription({ userId = null } = {}) {
  return readPushDevice({ userId, refresh: true })
}

export function pushErrorMessage(error) {
  if (error?.code === 'push-preference-disabled')
    return 'As notificações da conta estão desligadas. Consulte as preferências no Perfil.'
  if (error?.code === 'vapid-not-configured') return 'Push ainda não foi configurado pelo Evolutus.'
  if (error?.code === 'service-worker-unavailable')
    return 'O app ainda não está pronto. Recarregue e tente novamente.'
  if (error?.name === 'NotAllowedError')
    return 'Verifique a permissão nas configurações do navegador.'
  if (error?.name === 'AbortError')
    return 'O serviço de notificações interrompeu a ativação. Tente novamente.'
  return 'Não foi possível confirmar as notificações. Verifique sua conexão e tente novamente.'
}

async function revokePush({ allDevices, userId, generation }) {
  await assertIdentity(userId, generation)
  const registration = await currentRegistration()
  const subscription = registration ? await registration.pushManager.getSubscription() : null
  // Sem subscription local não há o que revogar neste dispositivo: nunca cair em
  // `p_endpoint = null`, que revogaria todos os dispositivos da conta.
  if (!allDevices && !subscription) return
  await assertIdentity(userId, generation)
  let failure = null
  try {
    const { error } = await pushRpc('unregister_push_subscription', {
      p_endpoint: allDevices ? null : subscription.endpoint,
    })
    if (error) failure = error
  } catch (error) {
    failure = error
  }
  // Mesmo com a revogação no servidor falhando (offline), encerra a subscription local: o provedor
  // passa a responder 410 e o worker a revoga na próxima entrega.
  await assertIdentity(userId, generation)
  if (subscription)
    await withTimeout(subscription.unsubscribe(), REVOKE_TIMEOUT_MS, 'push-revoke-timeout').catch(
      () => {}
    )
  if (failure) throw failure
}

// `explicit` (+ userId): o usuário escolheu desativar neste dispositivo -- guarda a escolha para o
// sync não reinscrever. Logout chama sem `explicit` (não é uma escolha).
export function disablePushNotifications({
  allDevices = false,
  explicit = false,
  userId = null,
} = {}) {
  invalidatePushOperations()
  if (explicit) setPushOptOut(userId, true)
  changed()
  const generation = revision
  return withTimeout(
    enqueue(() => revokePush({ allDevices, userId, generation })),
    REVOKE_TIMEOUT_MS,
    'push-revoke-timeout'
  )
}

export async function getPushStatus(endpoint = null) {
  const { data, error } = await pushRpc('get_my_push_status', { p_endpoint: endpoint })
  if (error) throw error
  return data
}

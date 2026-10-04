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

async function registerSubscription(subscription) {
  const { error } = await supabase.rpc('register_push_subscription', subscriptionParams(subscription))
  if (error) throw error
  return subscription
}

export async function enablePushNotifications() {
  const support = pushSupport()
  if (!support.supported) throw Object.assign(new Error(support.reason), { code: support.reason })
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { permission, subscription: null }
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!publicKey) throw Object.assign(new Error('VAPID_NOT_CONFIGURED'), { code: 'vapid-not-configured' })
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidPublicKey(publicKey),
    })
  }
  await registerSubscription(subscription)
  return { permission, subscription }
}

export async function syncPushSubscription() {
  if (!pushSupport().supported || Notification.permission !== 'granted') return null
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return subscription ? registerSubscription(subscription) : null
}

export async function disablePushNotifications({ allDevices = false } = {}) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  const { error } = await supabase.rpc('unregister_push_subscription', {
    p_endpoint: allDevices ? null : subscription?.endpoint || null,
  })
  if (error) throw error
  if (!allDevices) await subscription?.unsubscribe()
}

export async function getPushStatus() {
  const { data, error } = await supabase.rpc('get_my_push_status')
  if (error) throw error
  return data
}

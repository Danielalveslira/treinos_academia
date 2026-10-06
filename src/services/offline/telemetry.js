import { request, withTransaction } from './database.js'
import { DB_VERSION, STORES, userMetaKey } from './schema.js'

const EVENTS = new Set([
  'offline_write_created', 'sync_started', 'sync_completed', 'sync_retry',
  'sync_conflict', 'sync_failed', 'sync_recovered', 'offline_boot_used',
  'offline_boot_failed', 'indexeddb_unavailable', 'bootstrap_revalidated',
  'bootstrap_revalidation_failed',
])
const CODES = new Set(['CONFLICT', 'NETWORK', 'TIMEOUT', 'AUTH', 'ACCESS_DENIED', 'STORAGE', 'UNKNOWN'])
const MAX_QUEUE = 100
const MIN_INTERVAL_MS = 10_000
let identity = null
let authorized = false
let chain = Promise.resolve()
let flushTimer = null
const lastEvent = new Map()

export function safeTelemetryEvent(type, fields = {}) {
  if (!EVENTS.has(type)) return null
  const event = {
    event_type: type,
    app_version: /^[0-9A-Za-z._-]{1,32}$/.test(import.meta.env?.VITE_APP_VERSION || '1.0.0')
      ? (import.meta.env?.VITE_APP_VERSION || '1.0.0') : '1.0.0',
    schema_version: DB_VERSION,
  }
  for (const [key, max] of [['pending_count', 100000], ['batch_size', 50],
    ['attempt_number', 100], ['duration_ms', 3600000]]) {
    const value = fields[key]
    if (Number.isSafeInteger(value) && value >= 0 && value <= max) event[key] = value
  }
  if (CODES.has(fields.error_code)) event.error_code = fields.error_code
  return event
}

function telemetryKey(userId) { return userMetaKey(userId, 'offline-telemetry') }

function serialize(operation) {
  const task = chain.then(operation, operation)
  chain = task.catch(() => {})
  return task
}

export function setOfflineTelemetryContext(userId, serverConfirmed = false) {
  const next = userId || null
  if (identity !== next) lastEvent.clear()
  identity = next
  authorized = Boolean(identity && serverConfirmed)
  if (authorized) scheduleFlush(0)
  else clearTimeout(flushTimer)
}

export function queueOfflineTelemetry(type, fields = {}) {
  const userId = identity
  const event = safeTelemetryEvent(type, fields)
  if (!userId || !event) return Promise.resolve(false)
  // Agrega eventos frequentes por tipo; o servidor também limita a 120 eventos/h por conta.
  const key = `${userId}:${type}`
  const now = Date.now()
  if (now - (lastEvent.get(key) || 0) < MIN_INTERVAL_MS) return Promise.resolve(false)
  lastEvent.set(key, now)
  return serialize(async () => {
    try {
      await withTransaction([STORES.syncMeta], 'readwrite', async ({ syncMeta }) => {
        const row = await request(syncMeta.get(telemetryKey(userId)))
        const queue = Array.isArray(row?.value) ? row.value : []
        syncMeta.put({ key: telemetryKey(userId), value: [...queue, event].slice(-MAX_QUEUE) })
      })
      if (authorized && identity === userId) scheduleFlush(5000)
      return true
    } catch {
      // Se o próprio IndexedDB falhou, ainda registra o evento técnico com sessão online.
      if (authorized && identity === userId && globalThis.navigator?.onLine !== false)
        return sendDirect(userId, [event])
      return false
    } // telemetria jamais propaga erro para treino, boot ou sync
  })
}

async function sendDirect(userId, batch) {
  try {
    const { supabase } = await import('../../supabase/config')
    const { data: session } = await supabase.auth.getSession()
    if (session?.session?.user?.id !== userId) return false
    const { error } = await supabase.rpc('record_offline_telemetry', {
      p_events: batch, p_expected_user: userId,
    })
    return !error
  } catch { return false }
}

function scheduleFlush(delay) {
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => { flushOfflineTelemetry().catch(() => {}) }, delay)
  flushTimer?.unref?.()
}

export function flushOfflineTelemetry() {
  const userId = identity
  if (!userId || !authorized || globalThis.navigator?.onLine === false) return Promise.resolve(false)
  return serialize(async () => {
    try {
      const row = await withTransaction([STORES.syncMeta], 'readonly', ({ syncMeta }) =>
        request(syncMeta.get(telemetryKey(userId))))
      const batch = Array.isArray(row?.value) ? row.value.slice(0, 20) : []
      if (!batch.length || identity !== userId || !authorized) return true
      if (!(await sendDirect(userId, batch))) return false
      await withTransaction([STORES.syncMeta], 'readwrite', async ({ syncMeta }) => {
        const current = await request(syncMeta.get(telemetryKey(userId)))
        const remaining = Array.isArray(current?.value) ? current.value.slice(batch.length) : []
        syncMeta.put({ key: telemetryKey(userId), value: remaining })
      })
      return true
    } catch { return false }
  })
}

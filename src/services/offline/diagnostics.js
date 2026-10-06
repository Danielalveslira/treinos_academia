// Diagnóstico local para a homologação. Só contadores de eventos de uma lista fechada:
// nunca recebe user_id, mutation_id, payload, URL, mensagem de erro ou tokens. Não envia nada
// automaticamente. A equipe pode pedir ao testador o snapshot durante uma sessão de canário.
const EVENTS = new Set([
  'bootstrap_saved',
  'cold_start_opened',
  'cold_start_denied',
  'revalidation_ok',
  'revalidation_denied',
  'revalidation_session_expired',
  'local_write_saved',
  'sync_synced',
  'sync_retry',
  'sync_partial',
  'sync_failed',
  'sync_denied',
  'sync_auth',
  'sync_storage_error',
])

const counters = Object.create(null)
const startedAt = new Date().toISOString()
const PERSISTENT = {
  cold_start_opened: 'offline_boot_used',
  cold_start_denied: 'offline_boot_failed',
  revalidation_ok: 'bootstrap_revalidated',
  revalidation_denied: 'bootstrap_revalidation_failed',
  local_write_saved: 'offline_write_created',
  sync_retry: 'sync_retry',
  sync_failed: 'sync_failed',
}
let telemetryModule = null
const loadTelemetry = () => { telemetryModule ??= import('./telemetry.js'); return telemetryModule }

export function setOfflineTelemetryContext(userId, confirmed = false) {
  loadTelemetry().then((module) => module.setOfflineTelemetryContext(userId, confirmed)).catch(() => {})
}

export function flushOfflineTelemetry() {
  return loadTelemetry().then((module) => module.flushOfflineTelemetry()).catch(() => false)
}

export function recordOfflineDiagnostic(event) {
  if (!EVENTS.has(event)) return false
  counters[event] = Math.min((counters[event] ?? 0) + 1, 1_000_000)
  if (PERSISTENT[event]) loadTelemetry()
    .then((module) => module.queueOfflineTelemetry(PERSISTENT[event])).catch(() => {})
  return true
}

export function getOfflineDiagnostics() {
  return Object.freeze({ schema_version: 1, started_at: startedAt, counters: { ...counters } })
}

// Não há escrita em storage nem transporte. O snapshot é acessível no console de um aparelho de
// homologação com `evolutusOfflineDiagnostics()` e contém apenas as chaves acima e contagens.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'evolutusOfflineDiagnostics', {
    configurable: true,
    value: getOfflineDiagnostics,
    writable: false,
  })
}

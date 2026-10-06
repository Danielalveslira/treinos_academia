import { supabase } from '../../supabase/config'
import { createProbe } from './connectivity.js'
import { createSyncChannel } from './syncChannel.js'
import { withSyncLock } from './syncLock.js'
import { STATUS, isRelevantToDate, listMutations, retryFailed } from './outbox.js'
import { syncOutbox } from './syncEngine.js'
import { recordOfflineDiagnostic } from './diagnostics.js'
import { queueOfflineTelemetry } from './telemetry.js'
import {
  getSyncSnapshot,
  markSynced,
  refreshSyncStatus,
  setOnline,
  setSyncUser,
  setSyncing,
} from './syncStatusStore.js'

// Raiz de composição do sync: liga o Sync Engine (puro) ao Supabase real, ao lock entre abas, ao canal
// entre abas, ao estado da UI e aos eventos do navegador. NADA aqui é requisito para o app funcionar:
// sem Web Locks/BroadcastChannel/Background Sync ele continua correto (só com menos coordenação).
//
// Quando tenta sincronizar: ao abrir/autenticar (startSyncScheduler), no evento `online` (ignora o
// backoff), ao voltar para o primeiro plano (respeita o backoff), depois de cada escrita local
// (requestSync), no "Sincronizar agora" (syncNow) e no timer do próximo retry (só com a aba visível).

let probe = null
let channel = null
let deps = null

function getDeps() {
  if (deps) return deps
  probe = createProbe({
    baseUrl: import.meta.env?.VITE_SUPABASE_URL,
    anonKey: import.meta.env?.VITE_SUPABASE_ANON_KEY,
  })
  channel = createSyncChannel()
  deps = {
    getSession: async () => {
      try {
        const { data } = await supabase.auth.getSession()
        return { userId: data?.session?.user?.id ?? null }
      } catch {
        return { userId: null }
      }
    },
    rpc: async (mutations, userId, signal) => {
      const { data, error } = await supabase
        .rpc('sync_workout_mutations', { p_mutations: mutations, p_expected_user: userId })
        .abortSignal(signal)
      if (error) throw error
      return data
    },
    probe: probe.probe,
    markReachable: probe.markReachable,
    markUnreachable: probe.markUnreachable,
    withLock: withSyncLock,
    channel,
    now: () => Date.now(),
    random: Math.random,
    // `Sincronizando…` só termina em runOnce, DEPOIS de recontar a fila: sem isso o indicador piscaria
    // "aguardando" (contagem velha) entre o fim do envio e o "Sincronizado".
    onRunStart: () => {
      setSyncing(true)
      queueOfflineTelemetry('sync_started').catch(() => {})
    },
    onConflict: () => { queueOfflineTelemetry('sync_conflict', { error_code: 'CONFLICT' }).catch(() => {}) },
  }
  return deps
}

let running = null
let pendingRun = null
let retryTimer = null
let hadRetry = false

async function runOnce({ reason, force, filter = null }) {
  let result
  try {
    result = await syncOutbox({ force, reason, deps: getDeps(), filter })
  } catch (error) {
    console.warn('[sync] falha inesperada:', error?.name || 'Error')
    result = { status: 'storage-error', userId: null }
  }
  const diagnostic = `sync_${String(result.status).replaceAll('-', '_')}`
  recordOfflineDiagnostic(diagnostic)
  if (result.status === 'synced' && result.failed === 0 && result.applied > 0)
    queueOfflineTelemetry('sync_completed').catch(() => {})
  if (result.status === 'retry' || result.status === 'unreachable') hadRetry = true
  else if (result.status === 'synced' && result.applied > 0 && hadRetry) {
    queueOfflineTelemetry('sync_recovered').catch(() => {})
    hadRetry = false
  }
  if (['auth', 'denied', 'storage-error', 'user-changed'].includes(result.status)) {
    const errorCode = result.status === 'auth' ? 'AUTH' : result.status === 'denied'
      ? 'ACCESS_DENIED' : result.status === 'storage-error' ? 'STORAGE' : 'UNKNOWN'
    queueOfflineTelemetry('sync_failed', { error_code: errorCode }).catch(() => {})
  }
  try {
    await refreshSyncStatus(result.userId ?? undefined)
    if (result.applied > 0 && getSyncSnapshot().pending === 0) markSynced()
  } finally {
    setSyncing(false)
  }
  scheduleRetry(result)
  return result
}

function scheduleRetry(result) {
  clearTimeout(retryTimer)
  retryTimer = null
  if (result.status !== 'retry' && result.status !== 'unreachable') return
  const wait = result.nextAttemptAt ? result.nextAttemptAt - Date.now() : 15_000
  retryTimer = setTimeout(
    () => {
      if (globalThis.document?.visibilityState === 'hidden') return // o evento de foreground retoma
      requestSync('retry')
    },
    Math.min(Math.max(wait, 2_000), 300_000)
  )
  retryTimer?.unref?.() // Node/testes: o timer de retry não segura o processo (nos navegadores não existe)
}

// Uma execução por vez neste processo; pedidos que chegam durante uma execução viram UMA nova rodada
// (se algum deles não tem filtro, a rodada é completa).
function enqueueRun(job) {
  if (running) {
    pendingRun = pendingRun
      ? {
          reason: job.reason,
          force: job.force || pendingRun.force,
          filter: job.filter && pendingRun.filter ? job.filter : null,
        }
      : job
    return running
  }
  running = (async () => {
    try {
      let result = await runOnce(job)
      while (pendingRun) {
        const next = pendingRun
        pendingRun = null
        result = await runOnce(next)
      }
      return result
    } finally {
      running = null
    }
  })()
  return running
}

export function requestSync(reason = 'manual', { force = false } = {}) {
  return enqueueRun({ reason, force, filter: null })
}

// "Sincronizar agora": falhas voltam à fila e o envio ignora o backoff.
export async function syncNow() {
  const { userId } = await getDeps().getSession()
  if (userId) {
    await retryFailed(userId).catch(() => {})
    await refreshSyncStatus(userId)
  }
  return requestSync('manual', { force: true })
}

// Antes de "Finalizar treino": o servidor só enxerga o que já sincronizou, então as mutações que afetam
// o treino do dia `date` precisam estar CONFIRMADAS antes de pedir a conclusão. Sincroniza SÓ essas
// (ignora o backoff: o usuário está esperando) e mede SÓ essas. Pendência ou conflito de OUTRO dia não
// bloqueia e continua aparecendo no SyncStatus.
// Devolve { pending, failed, other }: relevantes ainda não confirmadas, relevantes que precisam de
// atenção, e quantas mutações de outros dias seguem na fila (informativo).
export async function flushPending(userId, { date } = {}) {
  const relevant = (mutation) => isRelevantToDate(mutation, date)
  await enqueueRun({ reason: 'finish', force: true, filter: relevant })
  const all = await listMutations(userId)
  const mine = all.filter(relevant)
  return {
    pending: mine.filter((m) => m.status === STATUS.pending || m.status === STATUS.syncing).length,
    failed: mine.filter((m) => m.status === STATUS.failed).length,
    other: all.length - mine.length,
  }
}

export function startSyncScheduler(userId) {
  getDeps()
  if (userId) setSyncUser(userId)
  const onOnline = () => {
    setOnline(true)
    requestSync('online', { force: true })
  }
  const onOffline = () => setOnline(false)
  const onVisibility = () => {
    if (globalThis.document?.visibilityState === 'visible') requestSync('foreground')
  }
  globalThis.addEventListener?.('online', onOnline)
  globalThis.addEventListener?.('offline', onOffline)
  globalThis.document?.addEventListener('visibilitychange', onVisibility)
  // Outra aba mexeu na fila ou sincronizou: só atualiza o espelho (quem sincroniza é uma aba só).
  const unsubscribe = channel.subscribe((message) => {
    if (message.userId === getSyncSnapshot().userId) refreshSyncStatus(message.userId)
  })
  setOnline(globalThis.navigator?.onLine !== false)
  refreshSyncStatus()
  requestSync('app-open')
  return () => {
    globalThis.removeEventListener?.('online', onOnline)
    globalThis.removeEventListener?.('offline', onOffline)
    globalThis.document?.removeEventListener('visibilitychange', onVisibility)
    unsubscribe()
    clearTimeout(retryTimer)
  }
}

// Avisa as outras abas que a fila mudou (escrita local, resolução de conflito).
export function announceOutboxChanged(userId) {
  getDeps().channel?.post('outbox-changed', userId)
}

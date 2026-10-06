// Configuração operacional vem do servidor. O cache é por conta e só recebe uma resposta válida
// autenticada; nunca concede autoridade server-side. VITE_* continua como chave mestra de segurança.
let activeUserId = null
const listeners = new Set()
const snapshots = new Map()
const inFlight = new Map()
const FEATURES = ['offline_write', 'offline_cold_start']

export function setOfflineRolloutUser(userId) {
  const next = typeof userId === 'string' && userId ? userId : null
  if (activeUserId === next) return
  activeUserId = next
  for (const listener of listeners) listener()
}

export function getOfflineRolloutUser() {
  return activeUserId
}

export function subscribeOfflineRollout(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function validateRolloutSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = {}
  for (const feature of FEATURES) {
    const entry = value[feature]
    if (entry == null) {
      result[feature] = { enabled: false, rollout_percentage: 0, updated_at: 0 }
      continue
    }
    const percent = entry?.rollout_percentage == null ? 0 : Number(entry.rollout_percentage)
    if (typeof entry?.enabled !== 'boolean' ||
        !Number.isFinite(percent) || percent < 0 || percent > 100) return null
    const date = typeof entry.updated_at === 'string' ? Date.parse(entry.updated_at) : entry.updated_at
    result[feature] = {
      enabled: entry.enabled,
      rollout_percentage: percent,
      updated_at: Number.isFinite(date) && date >= 0 ? date : 0,
    }
  }
  return result
}

export function setRemoteRolloutSnapshot(userId, raw, cache = false) {
  if (!userId) return false
  const snapshot = validateRolloutSnapshot(raw)
  if (!snapshot) return false
  const previous = snapshots.get(userId)
  const merged = !cache ? snapshot : Object.fromEntries(FEATURES.map((feature) => [feature,
    previous?.[feature]?.updated_at > snapshot[feature].updated_at
      ? previous[feature] : snapshot[feature]]))
  if (JSON.stringify(previous) === JSON.stringify(merged)) return true
  snapshots.set(userId, merged)
  if (userId === activeUserId) for (const listener of listeners) listener()
  return true
}

export function remoteFeatureAllowed(userId, feature) {
  const entry = snapshots.get(userId)?.[feature]
  return Boolean(entry?.enabled && isInOfflineRollout(userId, entry.rollout_percentage))
}

export async function hydrateOfflineRollout(userId, { force = false } = {}) {
  if (!userId || (snapshots.has(userId) && !force)) return snapshots.get(userId) ?? null
  try {
    const { withTransaction, request } = await import('./database.js')
    const cached = await withTransaction(['syncMeta'], 'readonly', ({ syncMeta }) =>
      request(syncMeta.get(`user:${userId}:offline-rollout`)))
    setRemoteRolloutSnapshot(userId, cached?.value, true)
  } catch { /* sem IDB = sem permissão offline inédita */ }
  return snapshots.get(userId) ?? null
}

export function refreshRemoteRollout(userId, client = null) {
  if (!userId) return Promise.resolve(false)
  if (inFlight.has(userId)) return inFlight.get(userId)
  const task = (async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    try {
      const supabase = client ?? (await import('../../supabase/config')).supabase
      const query = supabase.rpc('get_offline_feature_flags')
      const { data, error } = await (query.abortSignal
        ? query.abortSignal(controller.signal) : query)
      const { data: sessionData } = await supabase.auth.getSession()
      if (error || sessionData?.session?.user?.id !== userId ||
          !setRemoteRolloutSnapshot(userId, data)) return false
      const snapshot = snapshots.get(userId)
      const { withTransaction } = await import('./database.js')
      await withTransaction(['syncMeta'], 'readwrite', ({ syncMeta }) => {
        syncMeta.put({ key: `user:${userId}:offline-rollout`, value: snapshot })
      }).catch(() => {})
      return true
    } catch { return false }
    finally { clearTimeout(timeout) }
  })().finally(() => inFlight.delete(userId))
  inFlight.set(userId, task)
  return task
}

export function rolloutBucket(userId) {
  if (typeof userId !== 'string' || !userId) return null
  let hash = 2166136261
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 10_000
}

export function isInOfflineRollout(userId, rawPercent) {
  if (!userId || rawPercent === undefined || rawPercent === null || rawPercent === '') return false
  const percent = Number(rawPercent)
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return false
  return rolloutBucket(userId) < Math.floor(percent * 100)
}

// Em builds de desenvolvimento, as flags existentes continuam independentes para teste.
// Em produção, percentual ausente/inválido equivale a 0: ligar a flag por engano não libera
// a funcionalidade globalmente. Percentuais distintos permitem liberar escrita e cold start
// em etapas separadas. 100 só deve ser usado após o GO formal.
export function isRolloutAllowed(env, userId, feature) {
  if (!env?.PROD) return true
  return remoteFeatureAllowed(userId, feature)
}

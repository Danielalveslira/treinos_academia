import { attempt, request, withTransaction } from './database.js'
import { HOME_SNAPSHOT_META, STORES, userMetaKey } from './schema.js'
import { LOGOUT_KEY } from './bootstrap.js'

// Snapshot AGREGADO da Home para o cold start offline: um único registro por usuário no IndexedDB que já
// existe (syncMeta, chave `user:<id>:home-snapshot`), lido na MESMA transação do bootstrap (ver
// readOfflineEntry). Guarda só o que a UX offline precisa mostrar -- nada que autorize algo:
//
//   { schema_version, user_id, saved_at,
//     wallet?:      { coinBalance, lifetimeCoinsEarned, cashBalance, saved_at }   // SOMENTE EXIBIÇÃO
//     daily_coins?: { earned, limit, day, saved_at }                              // SOMENTE EXIBIÇÃO
//     progress?:    { start, end, days: [{ dateKey, workoutCount, strengthVolumeKg, exerciseStats }], saved_at } }
//
// A autoridade continua sendo o Supabase: este registro só pinta a última leitura conhecida (e some no
// logout/troca de conta junto com o bootstrap). Cada seção tem o próprio saved_at para a UI poder
// distinguir "valor real = 0", "ainda não carregado" e "nunca houve snapshot" (seção ausente).
export const HOME_SNAPSHOT_VERSION = 1

export const homeSnapshotKey = (userId) => userMetaKey(userId, HOME_SNAPSHOT_META)

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

export function sanitizeWallet(raw) {
  if (!raw || !isNumber(raw.coinBalance) || !isNumber(raw.cashBalance)) return null
  return {
    coinBalance: raw.coinBalance,
    lifetimeCoinsEarned: isNumber(raw.lifetimeCoinsEarned) ? raw.lifetimeCoinsEarned : 0,
    cashBalance: raw.cashBalance,
  }
}

export function sanitizeDailyCoins(raw) {
  if (!raw || !isNumber(raw.earned) || !isNumber(raw.limit) || typeof raw.day !== 'string') return null
  return { earned: raw.earned, limit: raw.limit, day: raw.day }
}

// Só o que a Home lê de cada dia (dateKey, treinos, volume e quais exercícios): o resto da resposta da RPC
// (séries, repetições, 1RM, cardio por exercício...) pertence à tela de Progresso, que exige servidor.
export function slimProgressDay(day) {
  if (!day || typeof day.dateKey !== 'string') return null
  return {
    dateKey: day.dateKey,
    workoutCount: Number(day.workoutCount) || 0,
    strengthVolumeKg: Number(day.strengthVolumeKg) || 0,
    exerciseStats: (Array.isArray(day.exerciseStats) ? day.exerciseStats : [])
      .filter((stat) => stat && typeof stat.exerciseId === 'string')
      .map((stat) => ({ exerciseId: stat.exerciseId })),
  }
}

export function sanitizeProgress(raw) {
  if (!raw || !Array.isArray(raw.days)) return null
  return {
    start: typeof raw.start === 'string' ? raw.start : null,
    end: typeof raw.end === 'string' ? raw.end : null,
    days: raw.days.map(slimProgressDay).filter(Boolean),
  }
}

// Falha SEGURA: versão desconhecida, outro usuário ou formato estranho = sem snapshot (nunca um dado de
// outra conta, nunca um zero inventado). Cada seção é validada de novo na leitura.
export function validateHomeSnapshot(value, userId) {
  if (!value || typeof value !== 'object') return null
  if (value.schema_version !== HOME_SNAPSHOT_VERSION) return null
  if (!userId || value.user_id !== userId || !isNumber(value.saved_at)) return null
  const snapshot = { schema_version: HOME_SNAPSHOT_VERSION, user_id: userId, saved_at: value.saved_at }
  const sections = [
    ['wallet', sanitizeWallet],
    ['daily_coins', sanitizeDailyCoins],
    ['progress', sanitizeProgress],
  ]
  for (const [name, sanitize] of sections) {
    const section = sanitize(value[name])
    if (section) snapshot[name] = { ...section, saved_at: isNumber(value[name].saved_at) ? value[name].saved_at : value.saved_at }
  }
  return snapshot
}

// Mescla `patch` ({ wallet?, daily_coins?, progress? }) no registro do usuário, numa transação. `at`: quando
// o dado chegou do servidor. Uma gravação que termina depois de um logout explícito da mesma conta é
// descartada (mesmo tombstone do bootstrap): o dado de quem saiu não volta ao disco.
export function saveHomeSnapshot(userId, patch, { at = Date.now() } = {}) {
  if (!userId || !patch) return Promise.resolve(false)
  return attempt(
    'home-snapshot:save',
    async () =>
      withTransaction([STORES.syncMeta], 'readwrite', async ({ syncMeta }) => {
        const logout = await request(syncMeta.get(LOGOUT_KEY))
        if (logout?.value?.userId === userId && logout.value.at >= at) return false
        const row = await request(syncMeta.get(homeSnapshotKey(userId)))
        const base = validateHomeSnapshot(row?.value, userId) ?? {
          schema_version: HOME_SNAPSHOT_VERSION,
          user_id: userId,
        }
        const next = { ...base, saved_at: at }
        const wallet = sanitizeWallet(patch.wallet)
        if (wallet) next.wallet = { ...wallet, saved_at: at }
        const daily = sanitizeDailyCoins(patch.daily_coins)
        if (daily) next.daily_coins = { ...daily, saved_at: at }
        const progress = sanitizeProgress(patch.progress)
        if (progress) next.progress = { ...progress, saved_at: at }
        if (next === base || (!wallet && !daily && !progress)) return false
        syncMeta.put({ key: homeSnapshotKey(userId), value: next })
        return true
      }),
    false
  )
}

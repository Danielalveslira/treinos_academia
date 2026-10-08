import { refreshRemoteRollout, rolloutFetchedAt } from './rollout.js'

// Passado ROLLOUT_MAX_STALE_ONLINE_MS com rede, a escrita volta a aguardar uma confirmação curta do
// servidor, para que um cache antigo nunca mantenha a feature ligada indefinidamente.
// Escrita normal não espera rede enquanto a última confirmação for mais nova que isto.
export const ROLLOUT_FRESH_MS = 60_000
export const ROLLOUT_MAX_STALE_ONLINE_MS = 10 * 60_000

export function rolloutSnapshotAgeMs(userId, now = Date.now()) {
  const at = rolloutFetchedAt.get(userId)
  return at === undefined ? Infinity : Math.max(0, now - at)
}

// Antes de uma escrita: snapshot fresco => nenhuma espera; velho (mas dentro do limite) => atualiza em
// segundo plano e segue; velho demais ou nunca confirmado => espera até `timeoutMs` pela resposta.
export async function prepareRolloutForWrite(userId, { timeoutMs = 1500, client = null } = {}) {
  const age = rolloutSnapshotAgeMs(userId)
  if (age < ROLLOUT_FRESH_MS) return
  const refresh = refreshRemoteRollout(userId, client)
  if (age < ROLLOUT_MAX_STALE_ONLINE_MS) return
  let timeout
  try {
    await Promise.race([refresh, new Promise((resolve) => { timeout = setTimeout(resolve, timeoutMs) })])
  } finally { clearTimeout(timeout) }
}


// Um único sync por usuário por vez, entre todas as abas/janelas do navegador.
//
// Preferência: Web Locks (`navigator.locks`), lock `evolutus-sync:<user_id>` com ifAvailable: quem não
// consegue o lock NÃO espera -- simplesmente sai (a aba que já está sincronizando cuida da fila).
// Fallback (sem Web Locks): trava em memória (mesma aba) + "lease" com prazo em localStorage (outras
// abas). O fallback é melhor-esforço (não é atômico entre abas); o servidor continua idempotente por
// mutation_id, então uma corrida rara só repete trabalho, nunca duplica dado.

const LEASE_PREFIX = 'evolutus:sync-lease:'
const LEASE_MS = 45_000
const heldInMemory = new Set()

export function lockName(userId) {
  return `evolutus-sync:${userId}`
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export async function withSyncLock(
  userId,
  work,
  {
    locks = globalThis.navigator?.locks,
    storage = safeStorage(),
    now = () => Date.now(),
    token = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random()),
  } = {}
) {
  if (!userId) return { acquired: false }
  const name = lockName(userId)

  if (locks && typeof locks.request === 'function') {
    let acquired = false
    let value
    await locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) return
      acquired = true
      value = await work()
    })
    return acquired ? { acquired: true, value } : { acquired: false }
  }

  if (heldInMemory.has(name)) return { acquired: false }
  const key = `${LEASE_PREFIX}${userId}`
  const mine = token()
  try {
    const current = storage?.getItem(key)
    if (current) {
      const [, expires] = current.split('|')
      if (Number(expires) > now()) return { acquired: false }
    }
    storage?.setItem(key, `${mine}|${now() + LEASE_MS}`)
  } catch {
    /* sem storage: só a trava em memória vale */
  }
  heldInMemory.add(name)
  try {
    return { acquired: true, value: await work() }
  } finally {
    heldInMemory.delete(name)
    try {
      if (storage?.getItem(key)?.startsWith(`${mine}|`)) storage.removeItem(key)
    } catch {
      /* nada a fazer */
    }
  }
}

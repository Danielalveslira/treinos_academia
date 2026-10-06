// Comunicação entre abas: UMA aba sincroniza (lock), as outras só atualizam estado/UI.
// Eventos: sync-started | sync-completed | sync-failed | outbox-changed  (sempre com userId).
// Preferência BroadcastChannel; sem ele, cai no evento `storage` do localStorage (que o navegador só
// dispara em OUTRAS abas -- exatamente o que queremos). Sem nenhum dos dois: sem comunicação, e cada
// aba ainda atualiza a si mesma (as pendências estão no IndexedDB, que é compartilhado).

export const SYNC_CHANNEL = 'evolutus-sync'
export const SYNC_EVENTS = Object.freeze([
  'sync-started',
  'sync-completed',
  'sync-failed',
  'outbox-changed',
])
const STORAGE_KEY = 'evolutus:sync-signal'

function isSyncMessage(message) {
  return (
    Boolean(message) &&
    typeof message === 'object' &&
    SYNC_EVENTS.includes(message.type) &&
    typeof message.userId === 'string'
  )
}

export function createSyncChannel({
  BroadcastChannelImpl = globalThis.BroadcastChannel,
  storage,
  target = globalThis,
} = {}) {
  let store = storage
  if (store === undefined) {
    try {
      store = globalThis.localStorage ?? null
    } catch {
      store = null
    }
  }
  const handlers = new Set()
  const deliver = (message) => {
    if (!isSyncMessage(message)) return
    for (const handler of handlers) {
      try {
        handler(message)
      } catch {
        /* um ouvinte com erro não derruba os outros */
      }
    }
  }

  let channel = null
  let storageListener = null
  if (typeof BroadcastChannelImpl === 'function') {
    try {
      channel = new BroadcastChannelImpl(SYNC_CHANNEL)
      channel.onmessage = (event) => deliver(event.data)
      // Não segura o processo vivo (Node/testes); nos navegadores o método não existe e é ignorado.
      channel.unref?.()
    } catch {
      channel = null
    }
  }
  if (!channel && store && typeof target?.addEventListener === 'function') {
    storageListener = (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        deliver(JSON.parse(event.newValue))
      } catch {
        /* sinal corrompido: ignora */
      }
    }
    target.addEventListener('storage', storageListener)
  }

  return {
    transport: channel ? 'broadcast-channel' : storageListener ? 'storage' : 'none',
    post(type, userId) {
      const message = { type, userId, at: Date.now() }
      try {
        if (channel) channel.postMessage(message)
        else if (storageListener)
          store.setItem(STORAGE_KEY, JSON.stringify({ ...message, nonce: Math.random() }))
      } catch {
        /* melhor-esforço */
      }
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    close() {
      handlers.clear()
      channel?.close()
      if (storageListener) target.removeEventListener('storage', storageListener)
    },
  }
}

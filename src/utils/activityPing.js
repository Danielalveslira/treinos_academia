// Rastreamento econômico de "último uso" (ver migration user_activity / touch_user_activity).
//
// Regras:
//  - no máximo UMA chamada a cada ACTIVITY_PING_INTERVAL_MS (10 min) por usuário neste aparelho,
//    mesmo com várias abas: o instante da última tentativa fica em localStorage e a aba que
//    "reserva" o direito de enviar grava antes de chamar a RPC;
//  - só com a página visível: ao abrir/retomar (visibilitychange -> visible) e depois por um
//    timer que existe apenas enquanto a página está visível. Escondida => nenhum timer, nenhum
//    envio, nenhuma consulta de leitura;
//  - o cliente não manda usuário, sessão nem horário: a RPC não recebe parâmetros.
//  - falha (offline, erro): devolve a reserva e tenta de novo só no próximo ciclo; nunca em loop.
export const ACTIVITY_PING_INTERVAL_MS = 10 * 60 * 1000
const KEY_PREFIX = 'evolutus:activity-ping:v1:'

export const activityPingKey = (uid) => `${KEY_PREFIX}${uid}`

export function clearActivityPingThrottle(storage = safeStorage()) {
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i)
      if (key?.startsWith(KEY_PREFIX)) storage.removeItem(key)
    }
  } catch {
    // Best-effort: sem storage, o pior caso é um envio a mais no próximo login.
  }
}

export function safeStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

// `storage` pode faltar (modo privado): nesse caso o limite vale só em memória, por aba.
export function createActivityPinger({
  send,
  uid,
  storage = safeStorage(),
  now = Date.now,
  intervalMs = ACTIVITY_PING_INTERVAL_MS,
}) {
  const key = activityPingKey(uid)
  let memoryLast = 0
  let inFlight = false

  const read = () => {
    try {
      return Number(storage?.getItem(key)) || memoryLast
    } catch {
      return memoryLast
    }
  }
  const write = (value) => {
    memoryLast = value
    try {
      if (value) storage?.setItem(key, String(value))
      else storage?.removeItem(key)
    } catch {
      // storage indisponível: vale o limite em memória
    }
  }

  // 'sent' | 'throttled' | 'busy' | 'failed'
  async function maybePing() {
    if (inFlight) return 'busy'
    const previous = read()
    const current = now()
    if (previous && current - previous < intervalMs) return 'throttled'
    inFlight = true
    write(current) // reserva ANTES de chamar: outra aba/chamada vê o limite imediatamente
    try {
      await send()
      return 'sent'
    } catch {
      if (read() === current) write(previous) // devolve a reserva só se ninguém mais a trocou
      return 'failed'
    } finally {
      inFlight = false
    }
  }

  return { maybePing }
}

// Liga o ciclo de vida: ping ao abrir/retomar e a cada intervalo SOMENTE com a página visível.
// Dependências injetáveis para teste. Devolve stop().
export function startActivityHeartbeat({
  pinger,
  doc = globalThis.document,
  win = globalThis.window,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  isOnline = () => globalThis.navigator?.onLine !== false,
  intervalMs = ACTIVITY_PING_INTERVAL_MS,
}) {
  let timer = null
  let stopped = false
  const visible = () => doc.visibilityState === 'visible'

  const cancel = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }
  const schedule = () => {
    cancel()
    if (stopped || !visible()) return
    timer = setTimer(tick, intervalMs)
  }
  async function tick() {
    timer = null
    if (stopped || !visible()) return
    if (isOnline()) await pinger.maybePing()
    schedule()
  }
  const onVisibility = () => {
    if (visible()) tick()
    else cancel() // escondida: nenhum timer vivo
  }
  const onOnline = () => {
    if (visible()) tick()
  }

  doc.addEventListener('visibilitychange', onVisibility)
  win?.addEventListener?.('online', onOnline)
  if (visible()) tick()

  return function stop() {
    stopped = true
    cancel()
    doc.removeEventListener('visibilitychange', onVisibility)
    win?.removeEventListener?.('online', onOnline)
  }
}

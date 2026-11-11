// Coletor de métricas de patrocinados (Fase 2). Módulo puro: tudo que toca o navegador entra por `deps`, então
// os testes injetam relógio, IntersectionObserver e envio falsos. A ligação com o navegador real está em runtime.js.
//
// O que conta (definições fechadas no servidor, que decide em última instância):
//  - impressão: anúncio com >= 50% da PRÓPRIA área visível por 1 s CONTÍNUO, com o documento visível e online.
//    Renderizar, carregar a imagem ou rodar timer não conta.
//  - clique: interação humana (evento confiável) no CTA. Nunca espera nem bloqueia a navegação. NÃO depende de
//    impressão: clique rápido (antes de 1 s visível) segue sozinho e o servidor o marca como "não qualificado".
//    Nunca se cria impressão para justificar clique; o lote leva a impressão (se já houver) ANTES do clique.
//
// Custo: UM IntersectionObserver compartilhado, no máximo UM timeout de qualificação (agendado para o próximo
// prazo, nunca setInterval nem por anúncio) e UM timeout de envio; nada de scroll listener. Estado só em memória:
// nada vai para localStorage/IndexedDB e o buffer morre no logout/troca de conta.

export const VISIBLE_RATIO = 0.5
export const DWELL_MS = 1000
export const MAX_BATCH = 20
export const MAX_BUFFER = 100
export const FLUSH_DELAY_MS = 5000
// Clique abre outra aba/app e a página pode ser suspensa em seguida: o envio não espera a janela inteira de agrupamento.
export const CLICK_FLUSH_DELAY_MS = 1500
export const RETRY_BASE_MS = 2000
export const MAX_ATTEMPTS = 3
export const SESSION_GRACE_MS = 2000
export const MAX_CLICKS_PER_SESSION_KEY = 3
// Se o timer de qualificação dispara muito depois do prazo, a aba foi congelada/dormiu: o período é descartado.
const MAX_LATE_MS = 2000

export const PLACEMENTS = ['home_banner', 'community_banner', 'community_feed', 'progress_banner']
// Home e Progresso são posicionamentos globais, sem comunidade -- mesma regra que o servidor
// aplica em record_ad_events (campo `community` ausente/null para os dois).
const NO_COMMUNITY_PLACEMENTS = ['home_banner', 'progress_banner']

const contextOf = (placement, communityId) =>
  NO_COMMUNITY_PLACEMENTS.includes(placement) ? 'home' : String(communityId)
const sessionKey = (meta) =>
  `${contextOf(meta.placement, meta.communityId)}|${meta.placement}|${meta.adId}`

function validMeta(meta) {
  if (!meta || typeof meta.adId !== 'string' || !PLACEMENTS.includes(meta.placement)) return false
  return NO_COMMUNITY_PLACEMENTS.includes(meta.placement)
    ? !meta.communityId
    : typeof meta.communityId === 'string'
}

function toEvent(id, type, meta) {
  const event = { id, type, ad: meta.adId, placement: meta.placement }
  if (!NO_COMMUNITY_PLACEMENTS.includes(meta.placement)) event.community = meta.communityId
  return event
}

// deps: { IntersectionObserverCtor, documentRef, windowRef, now(), setTimer, clearTimer, isOnline(),
//         randomId(), send(events, { keepalive, userId }) -> Promise<{ ok, retryable?, enabled? }> }
export function createAdMetricsCollector(deps) {
  const {
    IntersectionObserverCtor,
    documentRef,
    windowRef,
    now,
    setTimer,
    clearTimer,
    isOnline,
    randomId,
    send,
  } = deps

  let userId = null
  let disabled = false
  let observer = null
  const entries = new Map() // elemento -> { meta, key, ctx, ratioOk, since }
  const contexts = new Map() // ctx -> { count, endTimer }
  let counted = new Set() // chaves já contadas na sessão de exibição do contexto
  let clicks = new Map()
  let buffer = [] // eventos aguardando envio (ids estáveis entre tentativas)
  let qualifyTimer = null
  let qualifyDue = 0
  let flushTimer = null
  let flushDue = 0
  let inFlight = false
  let attempts = 0
  let listening = false

  const canCount = () =>
    !disabled && userId !== null && isOnline() && documentRef.visibilityState !== 'hidden'

  function clearQualifyTimer() {
    if (qualifyTimer !== null) clearTimer(qualifyTimer)
    qualifyTimer = null
  }

  function scheduleQualify() {
    clearQualifyTimer()
    let next = null
    for (const entry of entries.values()) {
      if (entry.since !== null && (next === null || entry.since < next)) next = entry.since
    }
    if (next === null) return
    qualifyDue = next + DWELL_MS
    qualifyTimer = setTimer(qualify, Math.max(0, qualifyDue - now()))
  }

  function qualify() {
    qualifyTimer = null
    const t = now()
    if (!canCount()) {
      // Aba oculta/offline/sem conta: qualquer período em andamento fica invalidado (volta a contar do zero).
      interrupt()
      return
    }
    if (t - qualifyDue > MAX_LATE_MS) {
      // Atraso grande: não dá para afirmar que ficou visível o tempo todo.
      for (const entry of entries.values()) if (entry.since !== null) entry.since = t
    } else {
      for (const entry of entries.values()) {
        if (entry.since !== null && t - entry.since >= DWELL_MS) {
          entry.since = null
          if (!counted.has(entry.key)) {
            counted.add(entry.key)
            enqueue(toEvent(randomId(), 'impression', entry.meta))
          }
        }
      }
    }
    scheduleQualify()
  }

  // (Re)inicia a contagem de 1 s para quem está a >= 50% e ainda não foi contado.
  function armVisible() {
    if (!canCount()) return
    const t = now()
    for (const entry of entries.values()) {
      if (entry.ratioOk && entry.since === null && !counted.has(entry.key)) entry.since = t
    }
    scheduleQualify()
  }

  function interrupt() {
    for (const entry of entries.values()) entry.since = null
    clearQualifyTimer()
  }

  function onIntersect(list) {
    let changed = false
    for (const item of list) {
      const entry = entries.get(item.target)
      if (!entry) continue
      const ok = item.intersectionRatio >= VISIBLE_RATIO
      if (ok === entry.ratioOk) continue
      entry.ratioOk = ok
      entry.since = ok && canCount() && !counted.has(entry.key) ? now() : null
      changed = true
    }
    if (changed) scheduleQualify()
  }

  function onVisibility() {
    if (documentRef.visibilityState === 'hidden') {
      interrupt()
      flush({ keepalive: true })
    } else {
      armVisible()
    }
  }

  function onOffline() {
    interrupt()
  }

  function onOnline() {
    armVisible()
    flush()
  }

  function onPageHide() {
    interrupt()
    flush({ keepalive: true })
  }

  function listen() {
    if (listening) return
    listening = true
    documentRef.addEventListener('visibilitychange', onVisibility)
    windowRef.addEventListener('offline', onOffline)
    windowRef.addEventListener('online', onOnline)
    windowRef.addEventListener('pagehide', onPageHide)
  }

  function unlisten() {
    if (!listening) return
    listening = false
    documentRef.removeEventListener('visibilitychange', onVisibility)
    windowRef.removeEventListener('offline', onOffline)
    windowRef.removeEventListener('online', onOnline)
    windowRef.removeEventListener('pagehide', onPageHide)
  }

  function ensureObserver() {
    if (observer || !IntersectionObserverCtor) return observer
    observer = new IntersectionObserverCtor(onIntersect, { threshold: [VISIBLE_RATIO] })
    return observer
  }

  function endSessionLater(ctx) {
    const context = contexts.get(ctx)
    if (!context || context.endTimer !== null) return
    context.endTimer = setTimer(() => {
      const current = contexts.get(ctx)
      if (!current || current.count > 0) return
      contexts.delete(ctx)
      // Saiu do contexto (Home/comunidade): a próxima visita é uma nova sessão de exibição.
      for (const key of [...counted]) if (key.startsWith(`${ctx}|`)) counted.delete(key)
      for (const key of [...clicks.keys()]) if (key.startsWith(`${ctx}|`)) clicks.delete(key)
    }, SESSION_GRACE_MS)
  }

  function observe(element, meta) {
    if (disabled || !element || !validMeta(meta) || !ensureObserver()) return () => {}
    const key = sessionKey(meta)
    const ctx = contextOf(meta.placement, meta.communityId)
    const previous = entries.get(element)
    if (previous) release(element)
    entries.set(element, { meta, key, ctx, ratioOk: false, since: null })
    let context = contexts.get(ctx)
    if (!context) {
      context = { count: 0, endTimer: null }
      contexts.set(ctx, context)
    }
    if (context.endTimer !== null) clearTimer(context.endTimer)
    context.endTimer = null
    context.count += 1
    listen()
    observer.observe(element)
    return () => release(element, meta)
  }

  function release(element, expectedMeta) {
    const entry = entries.get(element)
    if (!entry || (expectedMeta && entry.meta !== expectedMeta)) return
    entries.delete(element)
    observer?.unobserve(element)
    const context = contexts.get(entry.ctx)
    if (context) {
      context.count -= 1
      if (context.count <= 0) endSessionLater(entry.ctx)
    }
    if (entries.size === 0) {
      clearQualifyTimer()
    } else {
      scheduleQualify()
    }
  }

  function armFlush(delay) {
    if (flushTimer !== null) clearTimer(flushTimer)
    flushDue = now() + delay
    flushTimer = setTimer(() => {
      flushTimer = null
      flush()
    }, delay)
  }

  function enqueue(event) {
    if (disabled || userId === null) return
    buffer.push(event)
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER)
    if (buffer.length >= MAX_BATCH) {
      flush()
    } else if (flushTimer === null) {
      armFlush(event.type === 'click' ? CLICK_FLUSH_DELAY_MS : FLUSH_DELAY_MS)
    } else if (
      event.type === 'click' &&
      attempts === 0 &&
      flushDue - now() > CLICK_FLUSH_DELAY_MS
    ) {
      armFlush(CLICK_FLUSH_DELAY_MS) // adianta a janela já aberta; um retry em backoff não é encurtado
    }
  }

  function click(meta) {
    if (!canCountClick() || !validMeta(meta)) return
    const key = sessionKey(meta)
    const used = clicks.get(key) ?? 0
    if (used >= MAX_CLICKS_PER_SESSION_KEY) return
    clicks.set(key, used + 1)
    enqueue(toEvent(randomId(), 'click', meta))
  }

  // Clique não depende de a aba estar visível/online no instante do qualify; só da coleta estar ativa.
  const canCountClick = () => !disabled && userId !== null

  function dropBuffer() {
    buffer = []
    attempts = 0
    if (flushTimer !== null) clearTimer(flushTimer)
    flushTimer = null
  }

  async function flush({ keepalive = false } = {}) {
    if (flushTimer !== null) {
      clearTimer(flushTimer)
      flushTimer = null
    }
    if (inFlight || disabled || userId === null || buffer.length === 0 || !isOnline()) return
    inFlight = true
    const owner = userId
    const batch = buffer.slice(0, MAX_BATCH)
    let result
    try {
      result = await send(batch, { keepalive, userId: owner })
    } catch {
      result = { ok: false, retryable: true }
    }
    inFlight = false
    if (owner !== userId) return // trocou de conta durante o envio: o buffer já foi descartado
    if (result?.ok) {
      buffer.splice(0, batch.length)
      attempts = 0
      if (result.enabled === false) {
        disable()
        return
      }
      if (buffer.length > 0) flush({ keepalive })
      return
    }
    if (result?.retryable && attempts + 1 < MAX_ATTEMPTS) {
      attempts += 1
      armFlush(RETRY_BASE_MS * 2 ** (attempts - 1))
      return
    }
    // Falha definitiva (formato recusado, sessão inválida, tentativas esgotadas): descarta só este lote.
    buffer.splice(0, batch.length)
    attempts = 0
    if (buffer.length > 0) flush({ keepalive })
  }

  // O servidor respondeu enabled:false (chave desligada): para de coletar nesta sessão do app.
  function disable() {
    disabled = true
    dropBuffer()
    interrupt()
    for (const element of [...entries.keys()]) observer?.unobserve(element)
    entries.clear()
    contexts.clear()
    observer?.disconnect()
    observer = null
    unlisten()
  }

  function setUser(next) {
    const id = typeof next === 'string' && next ? next : null
    if (id === userId) return
    userId = id
    // Nada de conta anterior sobrevive: buffer, sessões contadas e cliques são zerados.
    dropBuffer()
    counted = new Set()
    clicks = new Map()
    interrupt()
    for (const entry of entries.values()) entry.since = null
    if (id !== null) {
      // Os elementos já observados continuam elegíveis para a nova conta: pede nova leitura do estado.
      if (observer)
        for (const element of entries.keys()) {
          observer.unobserve(element)
          observer.observe(element)
        }
      for (const entry of entries.values()) entry.ratioOk = false
    }
  }

  function dispose() {
    disable()
    disabled = false
    userId = null
  }

  return {
    observe,
    click,
    setUser,
    flush,
    dispose,
    // Somente leitura, para testes e diagnóstico.
    get state() {
      return { userId, disabled, buffered: buffer.length, observed: entries.size, attempts }
    },
  }
}

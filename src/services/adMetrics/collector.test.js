import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAdMetricsCollector,
  DWELL_MS,
  CLICK_FLUSH_DELAY_MS,
  FLUSH_DELAY_MS,
  MAX_BATCH,
  MAX_CLICKS_PER_SESSION_KEY,
  RETRY_BASE_MS,
  SESSION_GRACE_MS,
} from './collector.js'

// Relógio, timers, IntersectionObserver, documento e envio falsos: o coletor é puro, então a regra de
// 50% / 1 s se testa sem navegador e sem esperar de verdade.
function harness({ user = 'user-a', online = true, sendImpl } = {}) {
  let t = 1000
  let seq = 0
  let nextTimer = 1
  const timers = new Map()
  const listeners = { document: new Map(), window: new Map() }
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => listeners.document.set(type, fn),
    removeEventListener: (type) => listeners.document.delete(type),
  }
  const win = {
    addEventListener: (type, fn) => listeners.window.set(type, fn),
    removeEventListener: (type) => listeners.window.delete(type),
  }
  const observers = []
  class FakeIO {
    constructor(callback, options) {
      this.callback = callback
      this.options = options
      this.targets = new Set()
      observers.push(this)
    }
    observe(el) {
      this.targets.add(el)
    }
    unobserve(el) {
      this.targets.delete(el)
    }
    disconnect() {
      this.targets.clear()
    }
  }
  const state = { online, sends: [] }
  const send = async (events, opts) => {
    state.sends.push({ events: events.map((e) => ({ ...e })), ...opts })
    if (sendImpl) return sendImpl(events, opts, state.sends.length)
    return { ok: true, enabled: true }
  }
  const collector = createAdMetricsCollector({
    IntersectionObserverCtor: FakeIO,
    documentRef: doc,
    windowRef: win,
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextTimer++
      timers.set(id, { fn, at: t + ms })
      return id
    },
    clearTimer: (id) => timers.delete(id),
    isOnline: () => state.online,
    randomId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    send,
  })
  if (user) collector.setUser(user)
  const io = () => observers[0]
  return {
    collector,
    state,
    doc,
    observers,
    pendingTimers: () => timers.size,
    el: (name) => ({ name }),
    // Informa ao IO falso que o elemento está com `ratio` visível.
    see(el, ratio) {
      io().callback([{ target: el, intersectionRatio: ratio, isIntersecting: ratio > 0 }])
    },
    async advance(ms) {
      const end = t + ms
      for (;;) {
        let next = null
        for (const [id, timer] of timers)
          if (timer.at <= end && (!next || timer.at < next.timer.at)) next = { id, timer }
        if (!next) break
        t = Math.max(t, next.timer.at)
        timers.delete(next.id)
        next.timer.fn()
        await settle()
      }
      t = end
      await settle()
    },
    jumpClock(ms) {
      t += ms
    },
    fire(type, target = 'document') {
      listeners[target].get(type)?.()
    },
    sentEvents: () => state.sends.flatMap((s) => s.events),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const bannerMeta = (adId = 'ad-1', communityId = 'c1') => ({
  adId,
  placement: 'community_banner',
  communityId,
})
const feedMeta = (adId = 'ad-1', communityId = 'c1') => ({
  adId,
  placement: 'community_feed',
  communityId,
})
const homeMeta = (adId = 'ad-2') => ({ adId, placement: 'home_banner', communityId: null })

test('49% da área não conta, nem em 10 s', async () => {
  const h = harness()
  const el = h.el('a')
  h.collector.observe(el, bannerMeta())
  h.see(el, 0.49)
  await h.advance(10_000)
  await h.collector.flush()
  assert.equal(h.sentEvents().length, 0)
})

test('50% por 999 ms não conta; por 1000 ms conta', async () => {
  const h = harness()
  const a = h.el('a')
  const b = h.el('b')
  h.collector.observe(a, bannerMeta('ad-a'))
  h.see(a, 0.5)
  await h.advance(DWELL_MS - 1)
  h.see(a, 0.2) // saiu 1 ms antes de completar
  await h.advance(5000)
  await h.collector.flush()
  assert.equal(h.sentEvents().length, 0, '999 ms não conta')

  h.collector.observe(b, bannerMeta('ad-b'))
  h.see(b, 0.5)
  await h.advance(DWELL_MS)
  await h.collector.flush()
  assert.deepEqual(
    h.sentEvents().map((e) => [e.type, e.ad]),
    [['impression', 'ad-b']]
  )
})

test('renderizar ou observar sem visibilidade não conta; sair e voltar reinicia o segundo', async () => {
  const h = harness()
  const el = h.el('a')
  h.collector.observe(el, feedMeta())
  await h.advance(5000)
  h.see(el, 0.6)
  await h.advance(600)
  h.see(el, 0.1)
  await h.advance(100)
  h.see(el, 0.9)
  await h.advance(900) // 900 ms contínuos desde o retorno
  await h.collector.flush()
  assert.equal(h.sentEvents().length, 0)
  await h.advance(100)
  await h.collector.flush()
  assert.equal(h.sentEvents().length, 1)
})

test('aba oculta interrompe o período e voltar à aba recomeça do zero', async () => {
  const h = harness()
  const el = h.el('a')
  h.collector.observe(el, bannerMeta())
  h.see(el, 1)
  await h.advance(700)
  h.doc.visibilityState = 'hidden'
  h.fire('visibilitychange')
  await h.advance(10_000)
  assert.equal(h.sentEvents().length, 0, 'oculta: nada qualifica')
  h.doc.visibilityState = 'visible'
  h.fire('visibilitychange')
  await h.advance(900)
  await h.collector.flush()
  assert.equal(
    h.sentEvents().length,
    0,
    '900 ms após voltar ainda não basta (os 700 ms anteriores não somam)'
  )
  await h.advance(100)
  await h.collector.flush()
  assert.equal(h.sentEvents().length, 1)
})

test('aba que nasce oculta só conta depois de ficar visível por 1 s', async () => {
  const h = harness()
  h.doc.visibilityState = 'hidden'
  const el = h.el('a')
  h.collector.observe(el, bannerMeta())
  h.see(el, 1)
  await h.advance(5000)
  assert.equal(h.pendingTimers(), 0, 'sem timer de qualificação enquanto oculta')
  h.doc.visibilityState = 'visible'
  h.fire('visibilitychange')
  await h.advance(1000)
  await h.collector.flush()
  assert.equal(h.sentEvents().length, 1)
})

test('timer atrasado demais (aba congelada/dispositivo dormiu) descarta o período', async () => {
  const h = harness()
  const el = h.el('a')
  h.collector.observe(el, bannerMeta())
  h.see(el, 1)
  h.jumpClock(60_000) // o relógio andou, mas o timer só vai disparar agora
  await h.advance(500)
  await h.collector.flush()
  assert.equal(h.sentEvents().length, 0, 'prazo estourado por mais de 2 s: recomeça')
  await h.advance(600)
  await h.collector.flush()
  assert.equal(h.sentEvents().length, 1)
})

test('um único IntersectionObserver e no máximo um timer de qualificação para vários anúncios', async () => {
  const h = harness()
  const els = Array.from({ length: 12 }, (_, i) => h.el(`e${i}`))
  els.forEach((el, i) => h.collector.observe(el, feedMeta(`ad-${i}`)))
  assert.equal(h.observers.length, 1)
  assert.deepEqual(h.observers[0].options, { threshold: [0.5] })
  els.forEach((el) => h.see(el, 1))
  assert.equal(h.pendingTimers(), 1)
  await h.advance(1000)
  // 12 impressões num lote só, com 1 timer de envio pendente (nada de timer por anúncio)
  assert.equal(h.collector.state.buffered, 12)
  assert.equal(h.pendingTimers(), 1)
})

test('rodízio do carrossel: cada campanha conta a sua; voltar à primeira na mesma sessão não duplica', async () => {
  const h = harness()
  const root = h.el('banner')
  let stop = h.collector.observe(root, bannerMeta('ad-1'))
  h.see(root, 1)
  await h.advance(1000)
  stop()
  stop = h.collector.observe(root, bannerMeta('ad-2')) // mesmo elemento, nova campanha
  h.see(root, 1)
  await h.advance(1000)
  stop()
  stop = h.collector.observe(root, bannerMeta('ad-1')) // volta ao rodízio
  h.see(root, 1)
  await h.advance(3000)
  await h.collector.flush()
  assert.deepEqual(
    h.sentEvents().map((e) => e.ad),
    ['ad-1', 'ad-2']
  )
})

test('re-render (cleanup + novo observe do mesmo anúncio) não duplica a impressão', async () => {
  const h = harness()
  const el = h.el('a')
  for (let i = 0; i < 4; i += 1) {
    const stop = h.collector.observe(el, bannerMeta('ad-1'))
    h.see(el, 1)
    await h.advance(1000)
    stop()
  }
  const other = h.el('b')
  h.collector.observe(other, bannerMeta('ad-1')) // outro elemento da mesma campanha/contexto
  h.see(other, 1)
  await h.advance(2000)
  await h.collector.flush()
  assert.equal(h.sentEvents().length, 1)
})

test('mesma campanha em formatos diferentes (banner x feed) conta separado', async () => {
  const h = harness()
  const a = h.el('a')
  const b = h.el('b')
  h.collector.observe(a, bannerMeta('ad-1'))
  h.collector.observe(b, feedMeta('ad-1'))
  h.see(a, 1)
  h.see(b, 1)
  await h.advance(1000)
  await h.collector.flush()
  assert.deepEqual(
    h
      .sentEvents()
      .map((e) => e.placement)
      .sort(),
    ['community_banner', 'community_feed']
  )
})

test('troca de campanha enquanto o anúncio está visível exige novo segundo completo', async () => {
  const h = harness()
  const root = h.el('banner')
  const stop = h.collector.observe(root, bannerMeta('ad-1'))
  h.see(root, 1)
  await h.advance(800)
  stop()
  h.collector.observe(root, bannerMeta('ad-2'))
  h.see(root, 1)
  await h.advance(800)
  await h.collector.flush()
  assert.equal(h.sentEvents().length, 0, 'nenhuma das duas completou 1 s')
  await h.advance(200)
  await h.collector.flush()
  assert.deepEqual(
    h.sentEvents().map((e) => e.ad),
    ['ad-2']
  )
})

test('sair da comunidade encerra a sessão: voltar conta de novo; remontar logo em seguida, não', async () => {
  const h = harness()
  const el = h.el('a')
  let stop = h.collector.observe(el, feedMeta('ad-1', 'c1'))
  h.see(el, 1)
  await h.advance(1000)
  // remontagem imediata (mesmo commit do React): continua a mesma sessão
  stop()
  stop = h.collector.observe(el, feedMeta('ad-1', 'c1'))
  h.see(el, 1)
  await h.advance(1500)
  assert.equal(h.collector.state.buffered, 1)
  // sai de verdade
  stop()
  await h.advance(SESSION_GRACE_MS + 10)
  const again = h.el('again')
  h.collector.observe(again, feedMeta('ad-1', 'c1'))
  h.see(again, 1)
  await h.advance(1000)
  await h.collector.flush()
  assert.equal(h.sentEvents().length, 2, 'nova visita à comunidade = nova sessão de exibição')
})

test('Home e comunidade são contextos independentes; Home não envia community', async () => {
  const h = harness()
  const a = h.el('home')
  const b = h.el('comm')
  h.collector.observe(a, homeMeta('ad-2'))
  h.collector.observe(b, bannerMeta('ad-2', 'c1'))
  h.see(a, 1)
  h.see(b, 1)
  await h.advance(1000)
  await h.collector.flush()
  const [home, comm] = h
    .sentEvents()
    .sort((x, y) => x.placement.localeCompare(y.placement))
    .reverse()
  assert.equal('community' in home, false)
  assert.equal(home.placement, 'home_banner')
  assert.equal(comm.community, 'c1')
})

test('Progresso registra exposição global sem comunidade', async () => {
  const h = harness()
  const element = h.el('progress')
  h.collector.observe(element, { adId: 'ad-progress', placement: 'progress_banner', communityId: null })
  h.see(element, 1)
  await h.advance(1000)
  await h.collector.flush()
  const event = h.sentEvents()[0]
  assert.equal(event.placement, 'progress_banner')
  assert.equal('community' in event, false)
})

test('metadados inválidos são ignorados (Home com comunidade, comunidade sem id, posição desconhecida)', async () => {
  const h = harness()
  for (const meta of [
    { adId: 'x', placement: 'home_banner', communityId: 'c1' },
    { adId: 'x', placement: 'progress_banner', communityId: 'c1' },
    { adId: 'x', placement: 'community_banner', communityId: null },
    { adId: 'x', placement: 'sidebar', communityId: 'c1' },
    { placement: 'community_feed', communityId: 'c1' },
  ]) {
    const el = h.el('i')
    h.collector.observe(el, meta)
    if (h.observers[0]) h.see(el, 1)
  }
  await h.advance(3000)
  assert.equal(h.collector.state.observed, 0)
  assert.equal(h.collector.state.buffered, 0)
})

test('envio em lote: 5 s depois do primeiro evento, até 20 por requisição', async () => {
  const h = harness()
  const els = Array.from({ length: 25 }, (_, i) => h.el(`e${i}`))
  els.slice(0, 3).forEach((el, i) => h.collector.observe(el, feedMeta(`ad-${i}`)))
  els.slice(0, 3).forEach((el) => h.see(el, 1))
  await h.advance(1000)
  assert.equal(h.state.sends.length, 0, 'ainda dentro da janela de agrupamento')
  await h.advance(FLUSH_DELAY_MS)
  assert.equal(h.state.sends.length, 1)
  assert.equal(h.state.sends[0].events.length, 3)
  assert.equal(h.state.sends[0].keepalive, false)

  els.slice(3).forEach((el, i) => h.collector.observe(el, feedMeta(`ad-b${i}`)))
  els.slice(3).forEach((el) => h.see(el, 1))
  await h.advance(1000)
  // 22 eventos: o limiar de 20 dispara o envio na hora, e o resto sai na janela seguinte
  assert.equal(h.state.sends.at(-2).events.length, MAX_BATCH)
  await h.advance(FLUSH_DELAY_MS)
  assert.equal(h.sentEvents().length, 3 + 22)
  assert.ok(h.state.sends.every((s) => s.events.length <= MAX_BATCH))
})

test('aba oculta descarrega o buffer com keepalive', async () => {
  const h = harness()
  const el = h.el('a')
  h.collector.observe(el, bannerMeta())
  h.see(el, 1)
  await h.advance(1000)
  h.doc.visibilityState = 'hidden'
  h.fire('visibilitychange')
  await settle()
  assert.equal(h.state.sends.length, 1)
  assert.equal(h.state.sends[0].keepalive, true)
  h.fire('pagehide', 'window')
})

test('retry usa os MESMOS ids, recua 2 s e descarta após 3 tentativas', async () => {
  const h = harness({ sendImpl: async () => ({ ok: false, retryable: true }) })
  const el = h.el('a')
  h.collector.observe(el, bannerMeta())
  h.see(el, 1)
  await h.advance(1000 + FLUSH_DELAY_MS)
  assert.equal(h.state.sends.length, 1)
  await h.advance(RETRY_BASE_MS)
  assert.equal(h.state.sends.length, 2)
  await h.advance(RETRY_BASE_MS * 2)
  assert.equal(h.state.sends.length, 3)
  const ids = h.state.sends.map((s) => s.events[0].id)
  assert.equal(new Set(ids).size, 1, 'idempotency key estável entre tentativas')
  await h.advance(60_000)
  assert.equal(h.state.sends.length, 3, 'depois de 3 tentativas o lote é descartado')
  assert.equal(h.collector.state.buffered, 0)
})

test('retry bem-sucedido envia o lote uma vez só e limpa o buffer', async () => {
  const h = harness({
    sendImpl: async (_e, _o, n) =>
      n === 1 ? { ok: false, retryable: true } : { ok: true, enabled: true },
  })
  const el = h.el('a')
  h.collector.observe(el, bannerMeta())
  h.see(el, 1)
  await h.advance(1000 + FLUSH_DELAY_MS + RETRY_BASE_MS)
  assert.equal(h.state.sends.length, 2)
  assert.equal(h.collector.state.buffered, 0)
  await h.advance(60_000)
  assert.equal(h.state.sends.length, 2)
})

test('erro definitivo (formato recusado) descarta o lote sem repetir', async () => {
  const h = harness({ sendImpl: async () => ({ ok: false, retryable: false }) })
  const el = h.el('a')
  h.collector.observe(el, bannerMeta())
  h.see(el, 1)
  await h.advance(1000 + FLUSH_DELAY_MS)
  await h.advance(60_000)
  assert.equal(h.state.sends.length, 1)
  assert.equal(h.collector.state.buffered, 0)
})

test('ACK com enabled:false (chave do servidor desligada) para a coleta', async () => {
  const h = harness({ sendImpl: async () => ({ ok: true, enabled: false }) })
  const el = h.el('a')
  h.collector.observe(el, bannerMeta())
  h.see(el, 1)
  await h.advance(1000 + FLUSH_DELAY_MS)
  assert.equal(h.collector.state.disabled, true)
  assert.equal(h.collector.state.observed, 0)
  const other = h.el('b')
  h.collector.observe(other, bannerMeta('ad-9'))
  h.collector.click(bannerMeta('ad-9'))
  await h.advance(60_000)
  assert.equal(h.state.sends.length, 1, 'nada mais é coletado ou enviado')
})

test('offline suspende a coleta e não envia; ao voltar, envia o que já estava no buffer', async () => {
  const h = harness()
  const a = h.el('a')
  h.collector.observe(a, bannerMeta('ad-1'))
  h.see(a, 1)
  await h.advance(1000)
  assert.equal(h.collector.state.buffered, 1)

  h.state.online = false
  h.fire('offline', 'window')
  const b = h.el('b')
  h.collector.observe(b, bannerMeta('ad-2'))
  h.see(b, 1)
  await h.advance(FLUSH_DELAY_MS + 5000)
  assert.equal(h.state.sends.length, 0, 'offline: nada é enviado')
  assert.equal(h.collector.state.buffered, 1, 'e nada novo é contado')

  h.state.online = true
  h.fire('online', 'window')
  await settle()
  assert.equal(h.state.sends.length, 1, 'voltou: o buffer sai')
  await h.advance(1000)
  await h.collector.flush()
  assert.deepEqual(
    h.sentEvents().map((e) => e.ad),
    ['ad-1', 'ad-2'],
    'e o anúncio visível passa a contar depois de 1 s online'
  )
})

test('logout/troca de conta descarta buffer e sessões; eventos nunca migram para outra conta', async () => {
  const h = harness({ user: 'user-a' })
  const el = h.el('a')
  h.collector.observe(el, bannerMeta('ad-1'))
  h.see(el, 1)
  await h.advance(1000)
  assert.equal(h.collector.state.buffered, 1)

  h.collector.setUser(null) // logout
  assert.equal(h.collector.state.buffered, 0)
  await h.advance(FLUSH_DELAY_MS + 1000)
  assert.equal(h.state.sends.length, 0, 'nada enviado sem conta')

  h.collector.setUser('user-b')
  h.see(el, 1) // o IO falso reentrega o estado atual após o novo observe
  await h.advance(1000)
  await h.collector.flush()
  assert.equal(h.state.sends.length, 1)
  assert.equal(h.state.sends[0].userId, 'user-b')
  assert.equal(
    h.state.sends[0].events.length,
    1,
    'a nova conta conta a campanha por conta própria (sessão zerada)'
  )
})

test('troca de conta durante um envio em andamento não reaproveita o resultado nem o buffer', async () => {
  let release
  const h = harness({
    sendImpl: () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, enabled: true })
      }),
  })
  const el = h.el('a')
  h.collector.observe(el, bannerMeta('ad-1'))
  h.see(el, 1)
  await h.advance(1000 + FLUSH_DELAY_MS)
  assert.equal(h.state.sends[0].userId, 'user-a')
  h.collector.setUser('user-b')
  release()
  await settle()
  assert.equal(h.collector.state.buffered, 0)
  assert.equal(h.collector.state.disabled, false)
})

test('clique entra no buffer sem esperar envio; limite por sessão; ignora metadados inválidos', async () => {
  const h = harness()
  for (let i = 0; i < MAX_CLICKS_PER_SESSION_KEY + 5; i += 1) h.collector.click(feedMeta('ad-1'))
  assert.equal(h.collector.state.buffered, MAX_CLICKS_PER_SESSION_KEY)
  assert.equal(h.state.sends.length, 0, 'o clique só enfileira; o envio é assíncrono')
  h.collector.click({ adId: 'ad-1', placement: 'home_banner', communityId: 'c1' })
  assert.equal(h.collector.state.buffered, MAX_CLICKS_PER_SESSION_KEY)
  await h.advance(FLUSH_DELAY_MS)
  assert.deepEqual([...new Set(h.sentEvents().map((e) => e.type))], ['click'])
})

test('clique sem conta autenticada não é registrado', () => {
  const h = harness({ user: null })
  h.collector.click(bannerMeta())
  assert.equal(h.collector.state.buffered, 0)
})

test('o buffer em memória tem teto (nunca cresce sem limite se o envio falha)', async () => {
  const h = harness({ online: false })
  for (let i = 0; i < 300; i += 1)
    h.collector.click({ adId: `ad-${i}`, placement: 'community_feed', communityId: 'c1' })
  assert.ok(h.collector.state.buffered <= 100)
})

test('nada é gravado em armazenamento persistente', async () => {
  const touched = []
  const guard = (name) =>
    new Proxy({}, { get: (_t, prop) => (touched.push(`${name}.${String(prop)}`), () => null) })
  const before = { localStorage: globalThis.localStorage, indexedDB: globalThis.indexedDB }
  globalThis.localStorage = guard('localStorage')
  globalThis.indexedDB = guard('indexedDB')
  try {
    const h = harness()
    const el = h.el('a')
    h.collector.observe(el, bannerMeta())
    h.see(el, 1)
    h.collector.click(bannerMeta())
    await h.advance(1000 + FLUSH_DELAY_MS)
  } finally {
    globalThis.localStorage = before.localStorage
    globalThis.indexedDB = before.indexedDB
  }
  assert.deepEqual(touched, [])
})

test('clique antes de completar 1 s visível segue sozinho: nenhuma impressão é criada', async () => {
  const h = harness()
  const el = h.el('a')
  const stop = h.collector.observe(el, bannerMeta())
  h.see(el, 1)
  await h.advance(500)
  h.collector.click(bannerMeta()) // usuário toca no CTA antes de 1 s
  stop() // navegação interna desmonta o anúncio
  await h.advance(60_000)
  assert.deepEqual(
    h.sentEvents().map((e) => e.type),
    ['click'],
    'só o clique; a impressão não qualificada nunca é fabricada'
  )
})

test('clique com a impressão já qualificada no buffer: o lote leva a impressão ANTES do clique', async () => {
  const h = harness()
  const el = h.el('a')
  h.collector.observe(el, bannerMeta())
  h.see(el, 1)
  await h.advance(1000)
  h.collector.click(bannerMeta())
  await h.advance(CLICK_FLUSH_DELAY_MS)
  assert.equal(h.state.sends.length, 1, 'um único lote')
  assert.deepEqual(
    h.sentEvents().map((e) => e.type),
    ['impression', 'click']
  )
})

test('clique no CTA externo/WhatsApp: a aba some e o clique sai com keepalive, sem esperar a janela de 5 s', async () => {
  const h = harness()
  const el = h.el('a')
  h.collector.observe(el, feedMeta())
  h.see(el, 1)
  await h.advance(300)
  h.collector.click(feedMeta())
  h.doc.visibilityState = 'hidden' // o app/aba de destino assume o primeiro plano
  h.fire('visibilitychange')
  await settle()
  assert.equal(h.state.sends.length, 1)
  assert.equal(h.state.sends[0].keepalive, true)
  assert.deepEqual(
    h.sentEvents().map((e) => e.type),
    ['click']
  )
  h.doc.visibilityState = 'visible'
  h.fire('visibilitychange')
  await h.advance(2000)
  assert.equal(
    h.sentEvents().filter((e) => e.type === 'impression').length,
    0,
    'período interrompido não vira impressão'
  )
})

test('clique adianta a janela de agrupamento para 1,5 s; sem clique a janela segue em 5 s', async () => {
  const h = harness()
  const el = h.el('a')
  h.collector.observe(el, bannerMeta())
  h.see(el, 1)
  await h.advance(1000) // impressão no buffer; janela de 5 s aberta
  await h.advance(1000)
  h.collector.click(bannerMeta())
  await h.advance(CLICK_FLUSH_DELAY_MS - 1)
  assert.equal(h.state.sends.length, 0)
  await h.advance(1)
  assert.equal(h.state.sends.length, 1)
  assert.equal(h.sentEvents().length, 2)
})

test('clique não encurta o backoff de uma nova tentativa em andamento', async () => {
  const h = harness({
    sendImpl: async (_e, _o, n) =>
      n === 1 ? { ok: false, retryable: true } : { ok: true, enabled: true },
  })
  h.collector.click(bannerMeta())
  await h.advance(CLICK_FLUSH_DELAY_MS)
  assert.equal(h.state.sends.length, 1)
  h.collector.click(bannerMeta()) // chega durante o backoff de 2 s
  await h.advance(CLICK_FLUSH_DELAY_MS)
  assert.equal(h.state.sends.length, 1, 'ainda aguardando o backoff')
  await h.advance(RETRY_BASE_MS)
  assert.equal(h.state.sends.length, 2)
  const ids = h.state.sends.flatMap((send) => send.events.map((e) => e.id))
  assert.equal(
    new Set(ids).size,
    2,
    'reenvio usa os mesmos ids (1 do primeiro clique repetido + 1 novo)'
  )
})

test('clique e impressão pendentes na mesma janela (aba continua visível): os dois seguem no mesmo lote', async () => {
  const h = harness()
  const el = h.el('a')
  h.collector.observe(el, feedMeta())
  h.see(el, 1)
  await h.advance(400)
  h.collector.click(feedMeta()) // link em nova aba; esta continua visível
  await h.advance(600) // a impressão completa 1 s
  await h.advance(CLICK_FLUSH_DELAY_MS)
  assert.equal(h.state.sends.length, 1)
  assert.deepEqual(
    h.sentEvents().map((e) => e.type),
    ['click', 'impression'],
    'o servidor ordena impressão antes do clique ao processar o lote'
  )
})

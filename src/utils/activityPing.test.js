import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVITY_PING_INTERVAL_MS as INTERVAL,
  activityPingKey,
  clearActivityPingThrottle,
  createActivityPinger,
  startActivityHeartbeat,
} from './activityPing.js'

function memoryStorage() {
  const map = new Map()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  }
}
const clock = (start = 1_000_000) => {
  let t = start
  return { now: () => t, advance: (ms) => (t += ms) }
}

// ---------------------------------------------------------------- throttle

test('throttle: primeira chamada envia; dentro de 10 min não; depois de 10 min envia de novo', async () => {
  const c = clock()
  const storage = memoryStorage()
  let sent = 0
  const pinger = createActivityPinger({
    send: async () => void sent++,
    uid: 'u1',
    storage,
    now: c.now,
  })
  assert.equal(await pinger.maybePing(), 'sent')
  c.advance(INTERVAL - 1)
  assert.equal(await pinger.maybePing(), 'throttled')
  c.advance(1)
  assert.equal(await pinger.maybePing(), 'sent')
  assert.equal(sent, 2)
})

test('throttle é por usuário e não envia nada além do necessário', async () => {
  const c = clock()
  const storage = memoryStorage()
  const calls = []
  const a = createActivityPinger({
    send: async () => calls.push('a'),
    uid: 'a',
    storage,
    now: c.now,
  })
  const b = createActivityPinger({
    send: async () => calls.push('b'),
    uid: 'b',
    storage,
    now: c.now,
  })
  await a.maybePing()
  await b.maybePing()
  await a.maybePing()
  assert.deepEqual(calls, ['a', 'b'])
})

test('o cliente envia a RPC sem argumentos (usuário, sessão e horário são do servidor)', async () => {
  const seen = []
  const pinger = createActivityPinger({
    send: async (...args) => seen.push(args),
    uid: 'u',
    storage: memoryStorage(),
  })
  await pinger.maybePing()
  assert.deepEqual(seen, [[]])
})

// ------------------------------------------------------------- concorrência

test('concorrência: chamadas simultâneas na mesma aba resultam em UM envio', async () => {
  let sent = 0
  let release
  const gate = new Promise((r) => (release = r))
  const pinger = createActivityPinger({
    send: async () => {
      sent++
      await gate
    },
    uid: 'u',
    storage: memoryStorage(),
  })
  const results = [pinger.maybePing(), pinger.maybePing(), pinger.maybePing()]
  release()
  assert.deepEqual((await Promise.all(results)).sort(), ['busy', 'busy', 'sent'])
  assert.equal(sent, 1)
})

test('concorrência: duas abas do mesmo aparelho (mesmo storage) disparam UM envio', async () => {
  const c = clock()
  const storage = memoryStorage()
  let sent = 0
  const send = async () => void sent++
  const tab1 = createActivityPinger({ send, uid: 'u', storage, now: c.now })
  const tab2 = createActivityPinger({ send, uid: 'u', storage, now: c.now })
  const [r1, r2] = await Promise.all([tab1.maybePing(), tab2.maybePing()])
  assert.deepEqual([r1, r2].sort(), ['sent', 'throttled'])
  assert.equal(sent, 1)
})

test('falha devolve a reserva: nova tentativa é permitida, mas só quando o ciclo pedir', async () => {
  const c = clock()
  const storage = memoryStorage()
  let fail = true
  let sent = 0
  const pinger = createActivityPinger({
    send: async () => {
      if (fail) throw new Error('offline')
      sent++
    },
    uid: 'u',
    storage,
    now: c.now,
  })
  assert.equal(await pinger.maybePing(), 'failed')
  assert.equal(storage.getItem(activityPingKey('u')), null)
  fail = false
  assert.equal(await pinger.maybePing(), 'sent')
  assert.equal(sent, 1)
})

test('sem localStorage o limite vale em memória', async () => {
  const c = clock()
  let sent = 0
  const broken = {
    getItem() {
      throw new Error('bloqueado')
    },
    setItem() {
      throw new Error('bloqueado')
    },
    removeItem() {},
    length: 0,
    key: () => null,
  }
  const pinger = createActivityPinger({
    send: async () => void sent++,
    uid: 'u',
    storage: broken,
    now: c.now,
  })
  await pinger.maybePing()
  await pinger.maybePing()
  assert.equal(sent, 1)
})

test('logout limpa o limite: um novo login registra o uso na hora', async () => {
  const c = clock()
  const storage = memoryStorage()
  let sent = 0
  const make = () =>
    createActivityPinger({ send: async () => void sent++, uid: 'u', storage, now: c.now })
  await make().maybePing()
  clearActivityPingThrottle(storage)
  await make().maybePing()
  assert.equal(sent, 2)
})

// --------------------------------------------------- ciclo de vida / visibilidade

function fakeEnv({ visible = true, online = true } = {}) {
  const listeners = { doc: {}, win: {} }
  const doc = {
    visibilityState: visible ? 'visible' : 'hidden',
    addEventListener: (t, f) => (listeners.doc[t] = f),
    removeEventListener: (t) => delete listeners.doc[t],
  }
  const win = {
    addEventListener: (t, f) => (listeners.win[t] = f),
    removeEventListener: (t) => delete listeners.win[t],
  }
  const timers = new Map()
  let id = 0
  return {
    doc,
    win,
    listeners,
    timers,
    setTimer: (fn, ms) => {
      timers.set(++id, { fn, ms })
      return id
    },
    clearTimer: (t) => timers.delete(t),
    isOnline: () => online,
    setOnline: (v) => (online = v),
    show: (v) => {
      doc.visibilityState = v ? 'visible' : 'hidden'
      listeners.doc.visibilitychange?.()
    },
    fire: async () => {
      const [[tid, t]] = [...timers]
      timers.delete(tid)
      await t.fn()
      await Promise.resolve()
    },
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

test('abrir visível: 1 envio imediato e 1 timer de 10 min', async () => {
  const env = fakeEnv()
  let sent = 0
  const pinger = createActivityPinger({
    send: async () => void sent++,
    uid: 'u',
    storage: memoryStorage(),
  })
  const stop = startActivityHeartbeat({ pinger, ...env })
  await flush()
  assert.equal(sent, 1)
  assert.deepEqual(
    [...env.timers.values()].map((t) => t.ms),
    [INTERVAL]
  )
  stop()
  assert.equal(env.timers.size, 0)
})

test('página escondida: nenhum envio e nenhum timer; ao esconder, o timer é cancelado', async () => {
  const hidden = fakeEnv({ visible: false })
  let sent = 0
  const p1 = createActivityPinger({
    send: async () => void sent++,
    uid: 'u',
    storage: memoryStorage(),
  })
  const stop1 = startActivityHeartbeat({ pinger: p1, ...hidden })
  await flush()
  assert.equal(sent, 0)
  assert.equal(hidden.timers.size, 0)
  stop1()

  const env = fakeEnv()
  sent = 0
  const p2 = createActivityPinger({
    send: async () => void sent++,
    uid: 'u2',
    storage: memoryStorage(),
  })
  const stop2 = startActivityHeartbeat({ pinger: p2, ...env })
  await flush()
  assert.equal(env.timers.size, 1)
  env.show(false)
  assert.equal(env.timers.size, 0, 'esconder cancela o timer (nenhum heartbeat em segundo plano)')
  stop2()
})

test('retomar: só envia se já passaram 10 min; o timer só dispara enquanto visível', async () => {
  const c = clock()
  const env = fakeEnv()
  let sent = 0
  const pinger = createActivityPinger({
    send: async () => void sent++,
    uid: 'u',
    storage: memoryStorage(),
    now: c.now,
  })
  const stop = startActivityHeartbeat({ pinger, ...env })
  await flush()
  assert.equal(sent, 1)

  env.show(false)
  c.advance(60_000)
  env.show(true)
  await flush()
  assert.equal(sent, 1, 'retomar em 1 min: limitado')

  env.show(false)
  c.advance(INTERVAL)
  env.show(true)
  await flush()
  assert.equal(sent, 2, 'retomar depois de 10 min: envia')

  c.advance(INTERVAL)
  await env.fire()
  await flush()
  assert.equal(sent, 3, 'timer visível dispara a cada 10 min')
  assert.equal(env.timers.size, 1, 'e reagenda')
  stop()
})

test('offline não tenta enviar; ao voltar online envia (se visível)', async () => {
  const env = fakeEnv({ online: false })
  let sent = 0
  const pinger = createActivityPinger({
    send: async () => void sent++,
    uid: 'u',
    storage: memoryStorage(),
  })
  const stop = startActivityHeartbeat({ pinger, ...env })
  await flush()
  assert.equal(sent, 0)
  env.setOnline(true)
  env.listeners.win.online()
  await flush()
  assert.equal(sent, 1)
  stop()
})

test('stop remove os listeners e impede novos envios', async () => {
  const env = fakeEnv()
  let sent = 0
  const pinger = createActivityPinger({
    send: async () => void sent++,
    uid: 'u',
    storage: memoryStorage(),
  })
  const stop = startActivityHeartbeat({ pinger, ...env })
  await flush()
  stop()
  assert.deepEqual(env.listeners, { doc: {}, win: {} })
  assert.equal(env.timers.size, 0)
})

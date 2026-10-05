// A Central de Notificações (`notifications` = fonte de verdade) NÃO depende de Web Push: funciona
// com permissão negada, sem Service Worker, sem suporte a Push e com o backend de Push fora do ar.
import { after, afterEach, before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { setImmediate as tick } from 'node:timers/promises'
import { build } from 'esbuild'

let directory
let mod
let rows
let unread
let failList
let byId
let rpcLog

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}

const stubs = {
  name: 'stubs',
  setup(ctx) {
    ctx.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
    ctx.onResolve({ filter: /supabase\/config$/ }, () => ({ path: 'supabase', namespace: 'stub' }))
    ctx.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
      contents: `
        const slots = []
        let index = 0
        export const __reset = () => { slots.length = 0; index = 0 }
        export const __render = () => { index = 0 }
        export const useRef = (value) => { const i = index++; if (!(i in slots)) slots[i] = { current: value }; return slots[i] }
        export const useState = (initial) => { const i = index++; if (!(i in slots)) slots[i] = { value: initial }; return [slots[i].value, (v) => { slots[i].value = typeof v === 'function' ? v(slots[i].value) : v }] }
        export const useCallback = (fn, deps) => {
          const i = index++
          const slot = (slots[i] ||= { deps: undefined, fn: undefined })
          if (!slot.deps || !deps || deps.some((d, k) => d !== slot.deps[k])) { slot.fn = fn; slot.deps = deps }
          return slot.fn
        }
        const pending = []
        export const useEffect = (fn, deps) => {
          const i = index++
          const slot = (slots[i] ||= { deps: undefined, cleanup: null, effect: true })
          const changed = !slot.deps || !deps || deps.some((d, k) => d !== slot.deps[k])
          if (changed) pending.push(() => { slot.cleanup?.(); slot.cleanup = fn() || null; slot.deps = deps })
        }
        export const __flush = () => { while (pending.length) pending.shift()() }
        export const __unmount = () => { slots.forEach((slot) => slot?.effect && slot.cleanup?.()) }
      `,
    }))
    ctx.onLoad({ filter: /^supabase$/, namespace: 'stub' }, () => ({
      contents: `
        const query = () => {
          const q = { select: () => q, order: () => q, limit: () => q, is: () => q, or: () => q,
            eq: (_column, value) => { q.id = value; return q },
            maybeSingle: () => globalThis.__byId(q.id),
            then: (resolve, reject) => globalThis.__list().then(resolve, reject) }
          return q
        }
        const channel = (name) => {
          const ch = { name, handlers: [], statusCallback: null,
            on(type, filter, callback) { ch.handlers.push({ type, filter, callback }); return ch },
            subscribe(callback) { ch.statusCallback = callback; globalThis.__channels.push(ch); return ch } }
          return ch
        }
        export const supabase = { from: () => query(), rpc: (name) => globalThis.__rpc(name), channel,
          removeChannel: (ch) => { globalThis.__removed.push(ch.name) } }
      `,
    }))
  },
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'notification-center-tests-'))
  const outfile = join(directory, 'center.cjs')
  await build({
    stdin: {
      contents: `
        import { useNotificationCenter } from './useNotificationCenter.js'
        import { __reset, __render, __flush, __unmount } from 'react'
        export { useNotificationCenter, __reset, __render, __flush, __unmount }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [stubs],
  })
  mod = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const row = (id, extra = {}) => ({
  id, actor_id: null, actor_username: 'ana', type: 'comment_like', priority: 'normal', status_id: null,
  comment_id: null, community_id: null, entity_type: null, entity_id: null, action_url: null, metadata: {},
  read_at: null, created_at: `2026-10-04T10:0${id}:00+00:00`, ...extra,
})

beforeEach(() => {
  mod.__reset()
  globalThis.__channels = []
  globalThis.__removed = []
  byId = new Map()
  globalThis.__byId = async (id) => ({ data: byId.get(id) ?? null, error: null })
  setGlobal('document', { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} })
  rows = [row(2), row(1)]
  unread = 2
  failList = false
  globalThis.__list = () => (failList
    ? Promise.resolve({ data: null, error: new Error('boom') })
    : Promise.resolve({ data: rows, error: null }))
  rpcLog = []
  globalThis.__rpc = async (name) => {
    rpcLog.push(name)
    if (name === 'notifications_unread_count') return { data: unread, error: null }
    return { data: null, error: new Error(`rpc inesperada: ${name}`) }
  }
})

function render(options) {
  mod.__render()
  const center = mod.useNotificationCenter(options)
  mod.__flush()
  return center
}

const environments = {
  'permissão de Push negada': () => {
    setGlobal('Notification', { permission: 'denied' })
    setGlobal('navigator', { onLine: true, serviceWorker: { getRegistration: async () => undefined, ready: new Promise(() => {}) } })
  },
  'navegador sem Service Worker nem Notification': () => {
    setGlobal('Notification', undefined)
    setGlobal('navigator', { onLine: true })
  },
  'Service Worker travado e RPCs de Push inexistentes (404)': () => {
    setGlobal('Notification', { permission: 'default' })
    setGlobal('navigator', { onLine: true, serviceWorker: { getRegistration: () => new Promise(() => {}), ready: new Promise(() => {}) } })
  },
}

for (const [name, setup] of Object.entries(environments)) {
  test(`Central carrega lista e contador com ${name}`, async () => {
    setup()
    render().refresh()
    await tick()
    await tick()
    const center = render()
    assert.equal(center.list.loaded, true)
    assert.equal(center.list.error, false)
    assert.deepEqual(center.list.items.map((item) => item.id), [2, 1])
    assert.equal(center.unread, 2)
  })
}

test('nova notificação aparece e o contador atualiza no próximo refresh', async () => {
  environments['permissão de Push negada']()
  render().refresh()
  await tick()
  await tick()
  rows = [row(3), ...rows]
  unread = 3
  render().refresh()
  await tick()
  await tick()
  const center = render()
  assert.deepEqual(center.list.items.map((item) => item.id), [3, 2, 1])
  assert.equal(center.unread, 3)
})

test('falha ao listar mostra erro (com nova tentativa) em vez de ficar carregando', async () => {
  environments['permissão de Push negada']()
  failList = true
  render().refresh()
  await tick()
  await tick()
  let center = render()
  assert.equal(center.list.error, true)
  assert.equal(center.list.loading, false)
  failList = false
  center.refresh()
  await tick()
  await tick()
  center = render()
  assert.equal(center.list.error, false)
  assert.equal(center.list.items.length, 2)
})

test('o código da Central não importa nada de Web Push', async () => {
  const result = await build({
    entryPoints: [new URL('../components/NotificationBell.jsx', import.meta.url).pathname],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    packages: 'external',
    plugins: [{
      name: 'stub-supabase',
      setup(ctx) {
        ctx.onResolve({ filter: /supabase\/config$/ }, () => ({ path: 'supabase', external: true }))
      },
    }],
  })
  const inputs = Object.keys(result.metafile.inputs)
  assert.ok(inputs.some((file) => file.endsWith('useNotificationCenter.js')))
  // O único arquivo "push" permitido é o catálogo de textos (módulo puro, compartilhado com o worker).
  const pushFiles = inputs.filter((file) => /push/i.test(file))
  assert.deepEqual(pushFiles.map((file) => file.split('/').slice(-2).join('/')), ['process-push-outbox/messages.js'])
  assert.equal(inputs.some((file) => /pushService|usePushSubscriptionSync|PushNotificationSettings/.test(file)), false)
})

// ---- Realtime -----------------------------------------------------------------------------------
afterEach(() => {
  mod.__unmount()
  mock.timers.reset()
})

const rawRow = (id, extra = {}) => ({
  id, recipient_id: 'u-B', type: 'comment_like', read_at: null, archived_at: null,
  created_at: `2026-10-04T10:0${id}:00+00:00`, ...extra,
})

async function settle() {
  for (let i = 0; i < 4; i += 1) await tick()
}

async function connect(userId = 'u-B') {
  environments['permissão de Push negada']()
  render({ userId })
  await settle()
  return globalThis.__channels.at(-1)
}

function fire(channel, event, row) {
  const handler = channel.handlers.find((h) => h.filter.event === event)
  handler.callback({ eventType: event, new: row })
}

async function openLists(userId = 'u-B') {
  const center = render({ userId })
  center.refresh()
  await settle()
  render({ userId }).changeFilter('unread')
  await settle()
  return render({ userId })
}

test('Realtime: assina SOMENTE INSERT e UPDATE de notifications filtrados pelo destinatário', async () => {
  const channel = await connect('u-B')
  assert.equal(channel.name, 'notifications-u-B')
  assert.deepEqual(channel.handlers.map((h) => h.filter.event), ['INSERT', 'UPDATE'])
  for (const { filter } of channel.handlers) {
    assert.equal(filter.table, 'notifications')
    assert.equal(filter.schema, 'public')
    assert.equal(filter.filter, 'recipient_id=eq.u-B')
  }
})

test('Realtime: sem usuário ou desabilitado não abre canal', async () => {
  environments['permissão de Push negada']()
  render({ userId: null })
  render({ enabled: false, userId: 'u-B' })
  await settle()
  assert.equal(globalThis.__channels.length, 0)
})

test('central FECHADA: o badge sobe na hora com a notificação nova (sem recarregar)', async () => {
  const channel = await connect()
  assert.equal(render({ userId: 'u-B' }).unread, 2)
  byId.set(5, row(5, { actor_username: 'bia' }))
  fire(channel, 'INSERT', rawRow(5))
  assert.equal(render({ userId: 'u-B' }).unread, 3, 'badge atualizado imediatamente, antes de qualquer resposta de rede')
})

test('central ABERTA: a nova notificação entra no topo de Todas e de Não lidas, uma única vez', async () => {
  const channel = await connect()
  let center = await openLists()
  assert.deepEqual(center.list.items.map((i) => i.id), [2, 1])
  byId.set(5, row(5, { actor_username: 'bia' }))
  fire(channel, 'INSERT', rawRow(5))
  fire(channel, 'INSERT', rawRow(5)) // evento repetido
  await settle()
  center = render({ userId: 'u-B' })
  assert.deepEqual(center.list.items.map((i) => i.id), [5, 2, 1], 'aba Não lidas (filtro atual)')
  assert.equal(center.unread, 3, 'sem contar duas vezes')
  center.changeFilter('all')
  await settle()
  assert.deepEqual(render({ userId: 'u-B' }).list.items.map((i) => i.id), [5, 2, 1], 'aba Todas')
})

test('evento de notificação que a lista já carregou não duplica nem recontagem', async () => {
  const channel = await connect()
  await openLists()
  fire(channel, 'INSERT', rawRow(2))
  await settle()
  const center = render({ userId: 'u-B' })
  assert.deepEqual(center.list.items.map((i) => i.id), [2, 1])
  assert.equal(center.unread, 2)
})

test('UPDATE de read_at marca como lida, sai de Não lidas e baixa o badge uma vez', async () => {
  const channel = await connect()
  await openLists()
  fire(channel, 'UPDATE', rawRow(2, { read_at: '2026-10-04T11:00:00+00:00' }))
  fire(channel, 'UPDATE', rawRow(2, { read_at: '2026-10-04T11:00:00+00:00' })) // repetido
  const center = render({ userId: 'u-B' })
  assert.equal(center.unread, 1)
  assert.deepEqual(center.list.items.map((i) => i.id), [1], 'saiu da aba Não lidas')
  center.changeFilter('all')
  await settle()
  const all = render({ userId: 'u-B' }).list.items
  assert.equal(all.find((i) => i.id === 2).readAt, '2026-10-04T11:00:00+00:00')
})

test('UPDATE de archived_at remove da lista; arquivar já lida não mexe no badge', async () => {
  const channel = await connect()
  await openLists()
  fire(channel, 'UPDATE', rawRow(2, { archived_at: '2026-10-04T11:00:00+00:00' }))
  let center = render({ userId: 'u-B' })
  assert.deepEqual(center.list.items.map((i) => i.id), [1])
  assert.equal(center.unread, 1)
  fire(channel, 'UPDATE', rawRow(9, { archived_at: '2026-10-04T11:00:00+00:00', read_at: '2026-10-04T10:30:00+00:00' }))
  center = render({ userId: 'u-B' })
  assert.equal(center.unread, 1)
})

test('o badge reconcilia com o servidor depois do evento (debounce, sem polling)', async () => {
  const channel = await connect()
  mock.timers.enable({ apis: ['setTimeout'] })
  byId.set(5, row(5, { actor_username: 'bia' }))
  unread = 7 // o servidor sabe de outras notificações que o evento não mostrou
  const before = rpcLog.filter((n) => n === 'notifications_unread_count').length
  fire(channel, 'INSERT', rawRow(5))
  await settle()
  assert.equal(rpcLog.filter((n) => n === 'notifications_unread_count').length, before, 'nada de leitura imediata por evento')
  mock.timers.tick(900)
  await settle()
  assert.equal(rpcLog.filter((n) => n === 'notifications_unread_count').length, before + 1)
  assert.equal(render({ userId: 'u-B' }).unread, 7)
})

test('logout/desmontagem remove o canal e ignora eventos tardios', async () => {
  const channel = await connect('u-B')
  mod.__unmount()
  assert.deepEqual(globalThis.__removed, ['notifications-u-B'])
  byId.set(5, row(5, { actor_username: 'bia' }))
  const before = render({ userId: 'u-B' }).unread
  fire(channel, 'INSERT', rawRow(5))
  assert.equal(render({ userId: 'u-B' }).unread, before, 'evento depois do logout é ignorado')
})

test('troca de conta: remove o canal anterior, descarta o estado e não recebe eventos da conta antiga', async () => {
  const oldChannel = await connect('u-B')
  await openLists('u-B')
  render({ userId: 'u-C' })
  await settle()
  assert.deepEqual(globalThis.__removed, ['notifications-u-B'])
  const newChannel = globalThis.__channels.at(-1)
  assert.equal(newChannel.name, 'notifications-u-C')
  assert.equal(render({ userId: 'u-C' }).list.loaded, false, 'lista da conta anterior descartada')
  byId.set(5, row(5, { actor_username: 'bia' }))
  const before = render({ userId: 'u-C' }).unread
  fire(oldChannel, 'INSERT', rawRow(5)) // evento atrasado do canal antigo
  assert.equal(render({ userId: 'u-C' }).unread, before)
  fire(newChannel, 'INSERT', rawRow(6, { recipient_id: 'u-B' })) // linha de outro destinatário
  assert.equal(render({ userId: 'u-C' }).unread, before, 'linha de outro destinatário é ignorada')
})

test('reconexão do canal relê contador e listas abertas (eventos perdidos na queda)', async () => {
  const channel = await connect()
  await openLists()
  channel.statusCallback('SUBSCRIBED') // 1ª conexão já aconteceu em connect(); esta é uma reconexão
  rows = [row(3), ...rows]
  unread = 3
  channel.statusCallback('SUBSCRIBED')
  await settle()
  const center = render({ userId: 'u-B' })
  assert.equal(center.unread, 3)
  assert.deepEqual(center.list.items.map((i) => i.id), [3, 2, 1])
})

test('sem polling: o hook não usa setInterval', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('./useNotificationCenter.js', import.meta.url), 'utf8')
  assert.equal(/setInterval/.test(source), false)
})

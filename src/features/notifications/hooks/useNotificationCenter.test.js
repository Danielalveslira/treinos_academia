// A Central de Notificações (`notifications` = fonte de verdade) NÃO depende de Web Push: funciona
// com permissão negada, sem Service Worker, sem suporte a Push e com o backend de Push fora do ar.
import { after, before, beforeEach, test } from 'node:test'
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
        export const useCallback = (fn) => fn
        export const useEffect = () => {}
      `,
    }))
    ctx.onLoad({ filter: /^supabase$/, namespace: 'stub' }, () => ({
      contents: `
        const query = () => {
          const q = { select: () => q, order: () => q, limit: () => q, is: () => q, or: () => q,
            then: (resolve, reject) => globalThis.__list().then(resolve, reject) }
          return q
        }
        export const supabase = { from: () => query(), rpc: (name) => globalThis.__rpc(name) }
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
        import { __reset, __render } from 'react'
        export { useNotificationCenter, __reset, __render }
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
  rows = [row(2), row(1)]
  unread = 2
  failList = false
  globalThis.__list = () => (failList
    ? Promise.resolve({ data: null, error: new Error('boom') })
    : Promise.resolve({ data: rows, error: null }))
  globalThis.__rpc = async (name) => {
    if (name === 'notifications_unread_count') return { data: unread, error: null }
    return { data: null, error: new Error(`rpc inesperada: ${name}`) }
  }
})

function render() {
  mod.__render()
  return mod.useNotificationCenter()
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
  assert.deepEqual(inputs.filter((file) => /push/i.test(file)), [])
})

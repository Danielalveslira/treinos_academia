import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// O módulo supabase (fake) só é carregado no primeiro uso (import dinâmico); a lista de chamadas
// precisa existir antes disso.
globalThis.__calls = []
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'notifications-api-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        export * from './notifications.api.js'
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'fake-supabase',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/supabase\/config(\.js)?$/ }, (args) => ({
            path: args.path,
            namespace: 'fake',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
            contents: `
              const record = (call) => globalThis.__calls.push(call)
              export const supabase = {
                rpc: async (name, args) => {
                  record({ kind: 'rpc', name, args })
                  return globalThis.__rpcResult
                },
                from: (table) => {
                  const call = { kind: 'from', table, ops: [] }
                  record(call)
                  const builder = {
                    select: (columns) => { call.columns = columns; return builder },
                    order: (column, options) => { call.ops.push(['order', column, options.ascending]); return builder },
                    limit: (n) => { call.ops.push(['limit', n]); return builder },
                    is: (column, value) => { call.ops.push(['is', column, value]); return builder },
                    or: (expression) => { call.ops.push(['or', expression]); return builder },
                    then: (resolve) => resolve(globalThis.__queryResult),
                  }
                  return builder
                },
              }
            `,
          }))
        },
      },
    ],
  })
  return createRequire(import.meta.url)(outfile)
}

const api = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
const calls = globalThis.__calls
const reset = () => {
  calls.length = 0
}

test('badge usa a RPC de contagem e nunca lista notificações', async () => {
  reset()
  globalThis.__rpcResult = { data: 7, error: null }
  assert.equal(await api.countUnreadNotifications(), 7)
  assert.deepEqual(calls, [{ kind: 'rpc', name: 'notifications_unread_count', args: undefined }])
})

test('primeira página: ordenada por created_at/id, sem cursor e com limite pequeno', async () => {
  reset()
  globalThis.__queryResult = { data: [], error: null }
  await api.listNotifications()
  const [call] = calls
  assert.equal(call.table, 'notification_items')
  assert.deepEqual(call.ops, [
    ['order', 'created_at', false],
    ['order', 'id', false],
    ['limit', 12],
  ])
})

test('paginação por cursor (keyset) e filtro de não lidas, sem offset', async () => {
  reset()
  globalThis.__queryResult = { data: [], error: null }
  await api.listNotifications({
    unreadOnly: true,
    cursor: { createdAt: '2026-10-08T10:00:00+00:00', id: 5 },
  })
  const ops = calls[0].ops
  assert.ok(ops.some((op) => op[0] === 'is' && op[1] === 'read_at' && op[2] === null))
  const cursorOp = ops.find((op) => op[0] === 'or')
  assert.equal(
    cursorOp[1],
    'created_at.lt.2026-10-08T10:00:00+00:00,and(created_at.eq.2026-10-08T10:00:00+00:00,id.lt.5)'
  )
  assert.ok(!JSON.stringify(ops).includes('range'))
})

test('o limite por página nunca passa de 20', async () => {
  reset()
  globalThis.__queryResult = { data: [], error: null }
  await api.listNotifications({ limit: 500 })
  assert.ok(calls[0].ops.some((op) => op[0] === 'limit' && op[1] === 20))
})

test('mapeia os campos genéricos da notificação', async () => {
  globalThis.__queryResult = {
    data: [
      {
        id: 9,
        actor_id: null,
        actor_username: null,
        type: 'admin_report',
        priority: 'high',
        status_id: null,
        comment_id: null,
        community_id: null,
        entity_type: 'support_request',
        entity_id: 'r1',
        action_url: '/admin/moderacao',
        metadata: { kind: 'report' },
        read_at: null,
        created_at: '2026-10-08T10:00:00+00:00',
      },
    ],
    error: null,
  }
  const [item] = await api.listNotifications()
  assert.equal(item.priority, 'high')
  assert.equal(item.actionUrl, '/admin/moderacao')
  assert.equal(item.entityType, 'support_request')
  assert.deepEqual(item.metadata, { kind: 'report' })
})

test('marcar lidas e limpar usam as RPCs (limpar arquiva, não apaga)', async () => {
  reset()
  globalThis.__rpcResult = { error: null }
  await api.markNotificationsRead([3])
  await api.markAllNotificationsRead('2026-10-08T10:00:00+00:00')
  await api.archiveAllNotifications('2026-10-08T10:00:00+00:00')
  assert.deepEqual(
    calls.map((call) => [call.kind, call.name]),
    [
      ['rpc', 'notifications_mark_read'],
      ['rpc', 'notifications_mark_read'],
      ['rpc', 'notifications_archive'],
    ]
  )
  assert.deepEqual(calls[1].args, { p_ids: null, p_before: '2026-10-08T10:00:00+00:00' })
  assert.equal(
    calls.some((call) => call.kind === 'from'),
    false
  )
})

test('erros do banco são propagados', async () => {
  globalThis.__rpcResult = { data: null, error: new Error('boom') }
  await assert.rejects(() => api.countUnreadNotifications(), /boom/)
  globalThis.__queryResult = { data: null, error: new Error('boom') }
  await assert.rejects(() => api.listNotifications(), /boom/)
})

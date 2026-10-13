import { after, beforeEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Paginação do feed por cursor estável: a forma da consulta (sem OFFSET/range, desempate por id, filtro de
// expiração, limite pageSize+1) e a validação do cursor. Supabase falso que grava as operações.
let directory
let svc
const ops = []
let response = { data: [], error: null }

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'feed-page-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export { listCommunityFeedPage, isValidFeedCursor, FEED_PAGE_SIZE } from './statusesService.js'`,
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
        setup(context) {
          context.onResolve({ filter: /\/supabase\/config(\.js)?$/ }, (args) => ({
            path: args.path,
            namespace: 'fake',
          }))
          context.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
            contents: `
              const q = new Proxy({}, { get(_, op) {
                if (op === 'then') return (resolve) => resolve(globalThis.__response)
                return (...args) => { globalThis.__ops.push([op, ...args]); return q }
              } })
              export const supabase = { from: (t) => { globalThis.__ops.push(['from', t]); return q } }
            `,
          }))
        },
      },
    ],
  })
  globalThis.__ops = ops
  svc = createRequire(import.meta.url)(outfile)
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
beforeEach(() => {
  ops.length = 0
  response = { data: [], error: null }
  globalThis.__response = response
})
const row = (i) => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
  community_id: 'c',
  type: 'text',
  text: `t${i}`,
  created_at: '2026-10-08T12:00:00.123456+00:00',
})
const find = (op) => ops.filter(([name]) => name === op)

test('primeira página: ordem estável (created_at desc, id desc), pageSize+1, expiração, sem OFFSET/range', async () => {
  response.data = Array.from({ length: 11 }, (_, i) => row(i))
  globalThis.__response = response
  const page = await svc.listCommunityFeedPage('c1')
  assert.equal(page.items.length, 10)
  assert.equal(page.hasMore, true)
  assert.deepEqual(find('limit')[0].slice(1), [11])
  assert.deepEqual(
    find('order').map(([, col, o]) => [col, o.ascending]),
    [
      ['created_at', false],
      ['id', false],
    ]
  )
  assert.ok(find('or').some(([, f]) => /publication_expires_at\.is\.null/.test(f)))
  assert.equal(find('range').length + find('offset').length, 0, 'nunca usa OFFSET/range')
  assert.doesNotMatch(String(find('select')[0][1]), /\*/, 'colunas explícitas, sem select *')
})

test('última página: menos que pageSize+1 linhas = sem próxima página', async () => {
  response.data = Array.from({ length: 4 }, (_, i) => row(i))
  globalThis.__response = response
  const page = await svc.listCommunityFeedPage('c1')
  assert.equal(page.items.length, 4)
  assert.equal(page.hasMore, false)
})

test('com cursor: filtro por (created_at, id) com desempate, na forma original do banco', async () => {
  const cursor = {
    createdAt: '2026-10-08T12:00:00.123456+00:00',
    id: '00000000-0000-0000-0000-000000000007',
  }
  await svc.listCommunityFeedPage('c1', { cursor })
  const filter = find('or')
    .map(([, f]) => f)
    .find((f) => /created_at\.lt/.test(f))
  assert.equal(
    filter,
    `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
  )
})

test('cursor adulterado nunca vira sintaxe de filtro: é recusado antes de consultar', async () => {
  const bad = [
    { createdAt: 'x),and(community_id.neq.0', id: '00000000-0000-0000-0000-000000000007' },
    { createdAt: '2026-10-08T12:00:00Z', id: "1' or '1'='1" },
    {
      createdAt: '2026-10-08T12:00:00Z',
      id: '00000000-0000-0000-0000-000000000007),community_id.neq.x',
    },
    { createdAt: null, id: null },
    { createdAt: '2026-10-08', id: '00000000-0000-0000-0000-000000000007' },
    'texto',
  ]
  for (const cursor of bad) {
    ops.length = 0
    await assert.rejects(() => svc.listCommunityFeedPage('c1', { cursor }), /INVALID_FEED_CURSOR/)
    assert.equal(find('or').length + find('select').length, 0, 'nenhuma consulta foi montada')
  }
  assert.equal(
    svc.isValidFeedCursor({
      createdAt: '2026-10-08T12:00:00.5Z',
      id: '00000000-0000-0000-0000-000000000007',
    }),
    true
  )
  assert.equal(
    svc.isValidFeedCursor({
      createdAt: '2026-10-08T12:00:00.123456-03:00',
      id: 'AAAAAAAA-0000-0000-0000-000000000007',
    }),
    true
  )
})

test('erro do Supabase é lançado e o sinal de cancelamento é repassado', async () => {
  response.error = new Error('boom')
  globalThis.__response = response
  const controller = new AbortController()
  await assert.rejects(() => svc.listCommunityFeedPage('c1', { signal: controller.signal }), /boom/)
  assert.equal(find('abortSignal')[0][1], controller.signal)
})

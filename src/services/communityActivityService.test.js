import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// A prévia dos cartões lê a última publicação de TODAS as comunidades em uma única
// requisição (statuses embutido em communities, limit 1 por comunidade) + uma leitura em
// lote dos avatares — nunca uma requisição por comunidade. Aqui o Supabase é um fake que
// grava a forma das chamadas (o comportamento contra PostgREST + RLS reais é verificado
// com banco local, fora desta suíte).
let directory
const calls = []
let responses = {}

async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'community-activity-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export { listLatestCommunityActivity, buildCommunityActivity, ACTIVITY_BATCH_SIZE } from './statusesService.js'`,
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
              const query = (table) => {
                const call = { table, ops: [] }
                globalThis.__calls.push(call)
                const q = new Proxy({}, {
                  get(_, op) {
                    if (op === 'then') {
                      let r = globalThis.__responses[table] || { data: [], error: null }
                      if (typeof r === 'function') r = r(call)
                      return (resolve, reject) => Promise.resolve(r).then(resolve, reject)
                    }
                    return (...args) => { call.ops.push([op, ...args]); return q }
                  },
                })
                return q
              }
              export const supabase = { from: query }
            `,
          }))
        },
      },
    ],
  })
  globalThis.__calls = calls
  return createRequire(import.meta.url)(outfile)
}

const { listLatestCommunityActivity, buildCommunityActivity, ACTIVITY_BATCH_SIZE } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
beforeEach(() => {
  calls.length = 0
  responses = {}
  globalThis.__responses = responses
})

const status = (extra = {}) => ({
  id: 's1',
  community_id: 'c1',
  author_id: 'a1',
  author_username: 'ana',
  type: 'text',
  text: 'oi',
  created_at: '2026-10-08T10:00:00Z',
  ...extra,
})

test('uma única requisição de publicações para todas as comunidades (+1 de avatares)', async () => {
  responses.communities = {
    data: [
      { id: 'c1', statuses: [status()] },
      { id: 'c2', statuses: [] },
      { id: 'c3', statuses: [status({ author_id: 'a2', author_username: 'bia' })] },
    ],
    error: null,
  }
  responses.public_profiles = {
    data: [
      { user_id: 'a1', avatar_path: 'avatars/a1.webp' },
      { user_id: 'a2', avatar_path: null },
    ],
    error: null,
  }
  const { activity, checkedIds } = await listLatestCommunityActivity(['c1', 'c2', 'c3'])
  assert.deepEqual(
    calls.map((c) => c.table),
    ['communities', 'public_profiles']
  )
  assert.deepEqual(checkedIds, ['c1', 'c2', 'c3'])
  assert.deepEqual(Object.keys(activity), ['c1', 'c3'])
  assert.equal(activity.c1.authorAvatarPath, 'avatars/a1.webp')
  assert.equal(activity.c3.authorAvatarPath, null)
  // limite e ordenação aplicados ao recurso embutido (por comunidade), com filtro de expiração
  const ops = calls[0].ops
  assert.ok(
    ops.some(([op, n, o]) => op === 'limit' && n === 1 && o?.referencedTable === 'statuses')
  )
  assert.ok(
    ops.some(
      ([op, col, o]) =>
        op === 'order' &&
        col === 'created_at' &&
        o?.referencedTable === 'statuses' &&
        o?.ascending === false
    )
  )
  assert.ok(
    ops.some(
      ([op, f, o]) =>
        op === 'or' && /expires_at\.is\.null/.test(f) && o?.referencedTable === 'statuses'
    )
  )
})

test('sem nenhuma publicação não consulta avatares', async () => {
  responses.communities = { data: [{ id: 'c1', statuses: [] }], error: null }
  const { activity } = await listLatestCommunityActivity(['c1'])
  assert.deepEqual(activity, {})
  assert.deepEqual(
    calls.map((c) => c.table),
    ['communities']
  )
})

test('lista vazia não faz requisição', async () => {
  const result = await listLatestCommunityActivity([])
  assert.deepEqual(result, { activity: {}, checkedIds: [], partial: false })
  assert.equal(calls.length, 0)
})

const idsOf = (call) => call.ops.find(([op]) => op === 'in')[2]
const rowFor = (id, n = 0) => ({ id, statuses: [status({ id: `s-${id}`, author_id: `a${n}` })] })

test('IDs repetidos são deduplicados', async () => {
  responses.communities = { data: [], error: null }
  const { checkedIds } = await listLatestCommunityActivity(['c1', 'c2', 'c1', 'c2'])
  assert.deepEqual(checkedIds, ['c1', 'c2'])
  assert.equal(calls.length, 1)
})

test('sem teto funcional: 95 comunidades viram ceil(95/lote) requisições, não 95', async () => {
  const ids = Array.from({ length: 95 }, (_, i) => `c${i}`)
  responses.communities = (call) => ({
    data: idsOf(call).map((id) => ({ id, statuses: [] })),
    error: null,
  })
  const { activity, checkedIds, partial } = await listLatestCommunityActivity(ids)
  const communityCalls = calls.filter((c) => c.table === 'communities')
  assert.equal(communityCalls.length, Math.ceil(95 / ACTIVITY_BATCH_SIZE))
  assert.ok(communityCalls.every((c) => idsOf(c).length <= ACTIVITY_BATCH_SIZE))
  assert.deepEqual(checkedIds, ids)
  assert.deepEqual(activity, {})
  assert.equal(partial, false)
})

test('lotes são mesclados e os avatares também vão em lotes', async () => {
  const ids = Array.from({ length: 90 }, (_, i) => `c${i}`)
  responses.communities = (call) => ({
    data: idsOf(call).map((id) => rowFor(id, Number(id.slice(1)))),
    error: null,
  })
  responses.public_profiles = (call) => ({
    data: idsOf(call).map((user_id) => ({ user_id, avatar_path: `p/${user_id}` })),
    error: null,
  })
  const { activity } = await listLatestCommunityActivity(ids)
  assert.equal(Object.keys(activity).length, 90)
  assert.equal(activity.c89.authorAvatarPath, 'p/a89')
  const profileCalls = calls.filter((c) => c.table === 'public_profiles')
  assert.equal(profileCalls.length, Math.ceil(90 / ACTIVITY_BATCH_SIZE))
  assert.ok(profileCalls.every((c) => idsOf(c).length <= ACTIVITY_BATCH_SIZE))
})

test('um lote que falha não derruba os outros: só as comunidades dele ficam sem prévia e "não verificadas"', async () => {
  const log = console.error
  console.error = () => {}
  try {
    const ids = Array.from({ length: 50 }, (_, i) => `c${i}`)
    responses.communities = (call) =>
      idsOf(call).includes('c0')
        ? { data: null, error: new Error('lote 1 caiu') }
        : { data: idsOf(call).map((id) => rowFor(id)), error: null }
    const { activity, checkedIds, partial } = await listLatestCommunityActivity(ids)
    assert.equal(partial, true)
    assert.deepEqual(checkedIds, ids.slice(ACTIVITY_BATCH_SIZE))
    assert.deepEqual(Object.keys(activity), ids.slice(ACTIVITY_BATCH_SIZE))
  } finally {
    console.error = log
  }
})

test('todos os lotes falhando lança', async () => {
  const log = console.error
  console.error = () => {}
  try {
    const ids = Array.from({ length: 50 }, (_, i) => `c${i}`)
    responses.communities = { data: null, error: new Error('tudo caiu') }
    await assert.rejects(() => listLatestCommunityActivity(ids), /tudo caiu/)
  } finally {
    console.error = log
  }
})

test('publicação expirada não gera prévia: a comunidade fica "verificada e vazia"', async () => {
  // o filtro de expiração roda no banco (statuses.or no recurso embutido); quando nada sobra,
  // o embutido volta [] e a comunidade conta como consultada, sem publicação.
  responses.communities = { data: [{ id: 'c1', statuses: [] }], error: null }
  const { activity, checkedIds } = await listLatestCommunityActivity(['c1'])
  assert.deepEqual(activity, {})
  assert.deepEqual(checkedIds, ['c1'])
})

test('erro na leitura principal é lançado (a tela trata a prévia como secundária)', async () => {
  responses.communities = { data: null, error: new Error('boom') }
  await assert.rejects(() => listLatestCommunityActivity(['c1']), /boom/)
})

test('falha só nos avatares mantém a prévia (autor sem foto)', async () => {
  const log = console.error
  console.error = () => {}
  try {
    responses.communities = { data: [{ id: 'c1', statuses: [status()] }], error: null }
    responses.public_profiles = { data: null, error: new Error('avatars down') }
    const { activity } = await listLatestCommunityActivity(['c1'])
    assert.equal(activity.c1.authorUsername, 'ana')
    assert.equal(activity.c1.authorAvatarPath, null)
  } finally {
    console.error = log
  }
})

test('buildCommunityActivity: indexa pela comunidade e ignora linhas sem publicação', () => {
  const out = buildCommunityActivity(
    [
      { id: 'c1', statuses: [status({ type: 'poll', poll_question: 'Qual?', poll_options: [] })] },
      { id: 'c2', statuses: null },
    ],
    {}
  )
  assert.deepEqual(Object.keys(out), ['c1'])
  assert.equal(out.c1.poll.question, 'Qual?')
})

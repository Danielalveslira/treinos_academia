import { before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { CATALOG, SET, USER, loadHandler, post, resetFake } from '../_shared/edgeTestKit.js'

// Executa o index.ts REAL: expiração -> candidatos -> remoção de bytes (só bucket de rascunhos) -> marcação.
let handler
let fake
const DRAFTS = 'exercise-visual-drafts'
const PUBLIC = 'exercise-visuals'
const OTHER_SET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const draft = (set, file) => `${CATALOG}/${set}/${file}`

before(async () => {
  handler = await loadHandler(new URL('./index.ts', import.meta.url))
})

function candidate(set, status = 'failed', files = ['start.webp', 'end.webp']) {
  return {
    visual_set_id: set,
    catalog_id: CATALOG,
    status,
    assets: files.map((file) => ({
      role: { 'start.webp': 'start', 'end.webp': 'end', 'thumb.webp': 'thumbnail' }[file],
      path: draft(set, file),
    })),
  }
}

function arrange(candidates = [candidate(SET)]) {
  fake = resetFake()
  fake.expired = 2
  fake.candidates = candidates
  for (const row of candidates)
    for (const asset of row.assets) fake.buckets[DRAFTS].set(asset.path, new Uint8Array([1]))
  fake.buckets[PUBLIC].set(`${CATALOG}/v1/start.webp`, new Uint8Array([1]))
  fake.rpcResult = (name) => {
    if (name === 'expire_stale_exercise_visual_sets') return { data: fake.expired, error: null }
    if (name === 'list_exercise_visual_purge_candidates') return { data: fake.candidates, error: null }
    return { data: { alreadyPurged: false }, error: null }
  }
}
beforeEach(() => arrange())

const call = async (body = {}, options) => {
  const response = await handler(post(body, options))
  return { status: response.status, body: await response.json() }
}
const names = () => fake.rpcCalls.map(([name]) => name)

test('só superadmin: sem JWT 401, usuário comum 403, nada é chamado nem removido', async () => {
  assert.equal((await call({}, { auth: null })).status, 401)
  fake.authUser = { id: USER }
  assert.equal((await call()).status, 403)
  assert.deepEqual([fake.rpcCalls.length, fake.removed.length], [0, 0])
})

test('caminho feliz: expira, remove os bytes do bucket de rascunhos e só então marca como purgado', async () => {
  const result = await call()
  assert.deepEqual(result.body, { dryRun: false, expired: 2, candidates: 1, purged: 1, failed: 0, skipped: 0 })
  assert.deepEqual(names(), [
    'expire_stale_exercise_visual_sets',
    'list_exercise_visual_purge_candidates',
    'mark_exercise_visual_drafts_purged_internal',
  ])
  assert.deepEqual(fake.removed, [[DRAFTS, [draft(SET, 'start.webp'), draft(SET, 'end.webp')]]])
  assert.equal(fake.buckets[DRAFTS].size, 0)
  assert.equal(fake.buckets[PUBLIC].size, 1, 'o bucket público nunca é tocado')
})

test('falha ao remover os bytes: NÃO marca como purgado (o próximo ciclo tenta de novo)', async () => {
  fake.fail.remove = true
  const result = await call()
  assert.deepEqual([result.body.purged, result.body.failed], [0, 1])
  assert.ok(!names().includes('mark_exercise_visual_drafts_purged_internal'))
  assert.equal(fake.buckets[DRAFTS].size, 2, 'bytes preservados para a próxima tentativa')
})

test('falha ao marcar depois de remover: conta como falha e fica elegível de novo (remover é idempotente)', async () => {
  const original = fake.rpcResult
  fake.rpcResult = (name, args) =>
    name === 'mark_exercise_visual_drafts_purged_internal'
      ? { data: null, error: { message: 'boom' } }
      : original(name, args)
  assert.deepEqual((await call()).body.failed, 1)
  fake.rpcResult = original
  const retry = await call()
  assert.deepEqual([retry.body.purged, retry.body.failed], [1, 0])
})

test('paths inesperados vindos do banco são ignorados: nada é removido, nada é marcado', async () => {
  const evil = candidate(SET)
  evil.assets[1].path = `${CATALOG}/${OTHER_SET}/end.webp`
  const traversal = candidate(OTHER_SET)
  traversal.assets[0].path = `${CATALOG}/${OTHER_SET}/../${SET}/start.webp`
  arrange([evil, traversal])
  const result = await call()
  assert.deepEqual([result.body.skipped, result.body.purged], [2, 0])
  assert.deepEqual([fake.removed.length, names().filter((n) => n.startsWith('mark')).length], [0, 0])
})

test('published/archived/review/allocated nunca são removidos, mesmo se o banco os devolvesse por engano', async () => {
  arrange(['published', 'archived', 'review', 'allocated'].map((status) => candidate(SET, status)))
  const result = await call()
  assert.deepEqual([result.body.skipped, result.body.purged], [4, 0])
  assert.equal(fake.removed.length, 0)
  assert.equal(fake.buckets[DRAFTS].size, 2)
})

test('dryRun apenas lista: não expira, não remove, não marca', async () => {
  const result = await call({ dryRun: true })
  assert.deepEqual(result.body, { dryRun: true, expired: 0, candidates: 1 })
  assert.deepEqual(names(), ['list_exercise_visual_purge_candidates'])
  assert.equal(fake.removed.length, 0)
})

test('limit é limitado a 1-200 e repassado ao banco; erro ao listar vira INTERNAL_ERROR sem vazar detalhe', async () => {
  await call({ limit: 5000 })
  assert.equal(fake.rpcCalls[0][1].p_limit, 200)
  arrange()
  await call({ limit: 0 })
  assert.equal(fake.rpcCalls[0][1].p_limit, 1)
  arrange()
  await call({ limit: 'abc' })
  assert.equal(fake.rpcCalls[0][1].p_limit, 100)
  arrange()
  fake.rpcResult = (name) =>
    name === 'list_exercise_visual_purge_candidates'
      ? { data: null, error: { message: 'relation x does not exist' } }
      : { data: 0, error: null }
  assert.deepEqual(await call(), { status: 500, body: { error: 'INTERNAL_ERROR' } })
})

test('falha na expiração não impede a purga de quem já estava elegível', async () => {
  const original = fake.rpcResult
  fake.rpcResult = (name, args) =>
    name === 'expire_stale_exercise_visual_sets' ? { data: null, error: { message: 'x' } } : original(name, args)
  const result = await call()
  assert.deepEqual([result.body.expired, result.body.purged], [0, 1])
})

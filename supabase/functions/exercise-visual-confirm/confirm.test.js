import { before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  CATALOG,
  OTHER_ADMIN,
  SET,
  SUPERADMIN,
  USER,
  loadHandler,
  makeWebp,
  post,
  resetFake,
} from '../_shared/edgeTestKit.js'

// Executa o index.ts REAL da função (fakes só para Deno/Supabase). Cobre a auditoria: JWT, superadmin, paths
// alocados, WebP real/truncado, dimensões, tamanho, arquivo ausente, miniatura opcional e idempotência.
let handler
const DRAFTS = 'exercise-visual-drafts'
const path = (file) => `${CATALOG}/${SET}/${file}`
let fake

before(async () => {
  handler = await loadHandler(new URL('./index.ts', import.meta.url))
})

function arrange({ files = ['start', 'end', 'thumbnail'], overrides = {} } = {}) {
  fake = resetFake(overrides)
  const names = { start: 'start.webp', end: 'end.webp', thumbnail: 'thumb.webp' }
  fake.tables.exercise_visual_assets = ['start', 'end', 'thumbnail'].map((role) => ({
    visual_set_id: SET,
    role,
    storage_bucket: DRAFTS,
    storage_path: path(names[role]),
  }))
  for (const role of files)
    fake.buckets[DRAFTS].set(
      path(names[role]),
      makeWebp(role === 'thumbnail' ? 320 : 1024, role === 'thumbnail' ? 320 : 1024)
    )
}
beforeEach(() => arrange())

const rpcNames = () => fake.rpcCalls.map(([name]) => name)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

const call = async (body, options) => {
  const response = await handler(post(body, options))
  return { status: response.status, body: await response.json() }
}

test('sem JWT: 401; JWT inválido: 401; usuário comum: 403 FORBIDDEN (nada é baixado)', async () => {
  assert.equal((await call({ visualSetId: SET }, { auth: null })).status, 401)
  fake.authUser = null
  assert.equal((await call({ visualSetId: SET })).status, 401)
  arrange()
  fake.authUser = { id: USER }
  const result = await call({ visualSetId: SET })
  assert.deepEqual([result.status, result.body.error], [403, 'FORBIDDEN'])
  assert.deepEqual(fake.downloads, [])
})

test('visualSetId inválido: 400; conjunto de OUTRO superadmin: 403; inexistente: 403', async () => {
  assert.equal((await call({ visualSetId: 'x/../y' })).status, 400)
  fake.authUser = { id: OTHER_ADMIN }
  assert.deepEqual((await call({ visualSetId: SET })).body, { error: 'UPLOAD_NOT_AUTHORIZED' })
  fake.authUser = { id: SUPERADMIN }
  assert.equal((await call({ visualSetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })).status, 403)
  assert.equal(fake.rpcCalls.length, 0)
})

test('caminho feliz: valida os 3 arquivos e confirma com as medidas reais lidas do servidor', async () => {
  const result = await call({ visualSetId: SET })
  assert.equal(result.status, 200)
  const [name, args] = fake.rpcCalls[0]
  assert.equal(name, 'confirm_exercise_visual_internal')
  assert.equal(args.p_set_id, SET)
  assert.equal(args.p_actor, SUPERADMIN)
  assert.deepEqual(
    args.p_assets.map((a) => [a.role, a.width, a.height, a.mime_type]),
    [
      ['start', 1024, 1024, 'image/webp'],
      ['end', 1024, 1024, 'image/webp'],
      ['thumbnail', 320, 320, 'image/webp'],
    ]
  )
  assert.ok(args.p_assets.every((a) => a.byte_size === 64))
})

test('arquivo obrigatório ausente (upload incompleto): 400 MISSING_FILE e nada é confirmado', async () => {
  arrange({ files: ['start', 'thumbnail'] })
  const result = await call({ visualSetId: SET })
  assert.deepEqual([result.status, result.body.error], [400, 'MISSING_FILE'])
  assert.equal(fake.rpcCalls.length, 0)
})

test('não é WebP de verdade (PNG/HTML renomeado), cortado ou com tamanho/dimensão fora do limite: INVALID_IMAGE', async () => {
  const bad = {
    png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(60).fill(0)]),
    html: new TextEncoder().encode('<html>'.padEnd(64, ' ')),
    truncated: makeWebp(1024, 1024, { truncateTo: 40, riffSize: 56 }),
    tooWide: makeWebp(1025, 1024),
    tiny: makeWebp(32, 32),
    huge: new Uint8Array(2 * 1024 * 1024 + 1),
  }
  for (const [label, bytes] of Object.entries(bad)) {
    arrange()
    fake.buckets[DRAFTS].set(path('start.webp'), bytes)
    const result = await call({ visualSetId: SET })
    assert.deepEqual([label, result.status, result.body.error], [label, 400, 'INVALID_IMAGE'])
    // nada é confirmado; o conjunto é marcado como failed (o path é imutável: não há como regravar)
    assert.deepEqual([label, rpcNames()], [label, ['fail_exercise_visual_set_internal']])
    assert.deepEqual(fake.rpcCalls[0][1], { p_set_id: SET, p_actor: SUPERADMIN, p_reason: 'INVALID_IMAGE' })
  }
})

test('path traversal / path de outro conjunto gravado no banco é recusado ANTES de qualquer download', async () => {
  for (const evil of [
    '../other/start.webp',
    `${CATALOG}/${SET}/../start.webp`,
    `${CATALOG}/dddddddd-dddd-4ddd-8ddd-dddddddddddd/start.webp`,
    `/${path('start.webp')}`,
  ]) {
    arrange()
    fake.tables.exercise_visual_assets.find((a) => a.role === 'start').storage_path = evil
    const result = await call({ visualSetId: SET })
    assert.deepEqual([evil, result.body.error], [evil, 'INVALID_IMAGE'])
    assert.ok(!fake.downloads.some(([, p]) => p === evil), evil)
    assert.ok(!rpcNames().includes('confirm_exercise_visual_internal'))
  }
  arrange()
  fake.tables.exercise_visual_assets.find((a) => a.role === 'end').storage_bucket =
    'exercise-visuals'
  assert.equal((await call({ visualSetId: SET })).body.error, 'INVALID_IMAGE')
})

test('miniatura é opcional: ausente ou inválida => conjunto segue só com start/end', async () => {
  arrange({ files: ['start', 'end'] })
  assert.equal((await call({ visualSetId: SET })).status, 200)
  assert.deepEqual(
    fake.rpcCalls[0][1].p_assets.map((a) => a.role),
    ['start', 'end']
  )

  arrange()
  fake.buckets[DRAFTS].set(path('thumb.webp'), new Uint8Array([1, 2, 3]))
  assert.equal((await call({ visualSetId: SET })).status, 200)
  assert.deepEqual(
    fake.rpcCalls[0][1].p_assets.map((a) => a.role),
    ['start', 'end']
  )
})

test('idempotente: conjunto já em review devolve sucesso sem reprocessar; publicado/rejeitado continua recusado', async () => {
  fake.tables.exercise_visual_sets[0].status = 'review'
  const again = await call({ visualSetId: SET })
  assert.deepEqual(again.body, { visualSetId: SET, status: 'review', alreadyConfirmed: true })
  assert.deepEqual([fake.rpcCalls.length, fake.downloads.length], [0, 0])
  for (const status of ['published', 'rejected', 'archived', 'failed']) {
    fake.tables.exercise_visual_sets[0].status = status
    assert.equal((await call({ visualSetId: SET })).status, 403, status)
  }
})

test('erro na RPC interna: resposta de erro e o conjunto continua allocated (nada pela metade)', async () => {
  fake.rpcResult = () => ({ data: null, error: { message: 'boom' } })
  const result = await call({ visualSetId: SET })
  assert.deepEqual([result.status, result.body.error], [400, 'INTERNAL_ERROR'])
  assert.equal(fake.tables.exercise_visual_sets[0].status, 'allocated')
})

test('V2: grava o SHA-256 real de cada arquivo, a versão de validação e o dHash do navegador (só se bem formado)', async () => {
  const result = await call({
    visualSetId: SET,
    perceptualHashes: { start: 'f0f0f0f0f0f0f0f0', end: 'NAO-E-HEX', thumbnail: 123 },
  })
  assert.equal(result.status, 200)
  const items = Object.fromEntries(fake.rpcCalls[0][1].p_assets.map((a) => [a.role, a]))
  assert.equal(items.start.sha256, sha(fake.buckets[DRAFTS].get(path('start.webp'))))
  assert.match(items.end.sha256, /^[0-9a-f]{64}$/)
  assert.equal(items.start.perceptual_hash, 'f0f0f0f0f0f0f0f0')
  assert.equal('perceptual_hash' in items.end, false, 'dHash inválido é ignorado, não bloqueia')
  assert.equal('perceptual_hash' in items.thumbnail, false)
  assert.ok(Object.values(items).every((a) => a.validation_version === 2))
})

test('V2: EXIF ou XMP em start/end => IMAGE_METADATA_NOT_ALLOWED, nada confirmado e conjunto marcado como failed', async () => {
  for (const chunk of ['EXIF', 'XMP ']) {
    arrange()
    fake.buckets[DRAFTS].set(path('end.webp'), makeWebp(1024, 1024, { chunk }))
    const result = await call({ visualSetId: SET })
    assert.deepEqual([chunk, result.status, result.body.error], [chunk, 400, 'IMAGE_METADATA_NOT_ALLOWED'])
    assert.deepEqual(rpcNames(), ['fail_exercise_visual_set_internal'])
    assert.equal(fake.rpcCalls[0][1].p_reason, 'IMAGE_METADATA')
  }
})

test('V2: falha ao marcar failed não esconde o erro de validação; arquivo ausente NÃO marca failed (retry possível)', async () => {
  fake.rpcResult = () => ({ data: null, error: { message: 'boom' } })
  fake.buckets[DRAFTS].set(path('start.webp'), new Uint8Array(64))
  assert.deepEqual((await call({ visualSetId: SET })).body, { error: 'INVALID_IMAGE' })

  arrange({ files: ['start', 'thumbnail'] })
  assert.equal((await call({ visualSetId: SET })).body.error, 'MISSING_FILE')
  assert.deepEqual(rpcNames(), [])
})

test('V2: miniatura com EXIF é ignorada como qualquer miniatura inválida (start/end seguem)', async () => {
  fake.buckets[DRAFTS].set(path('thumb.webp'), makeWebp(320, 320, { chunk: 'EXIF' }))
  assert.equal((await call({ visualSetId: SET })).status, 200)
  assert.deepEqual(
    fake.rpcCalls[0][1].p_assets.map((a) => a.role),
    ['start', 'end']
  )
})

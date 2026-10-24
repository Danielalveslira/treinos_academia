import { before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  CATALOG,
  SET,
  SUPERADMIN,
  USER,
  loadHandler,
  makeWebp,
  post,
  resetFake,
} from '../_shared/edgeTestKit.js'

// Executa o index.ts REAL: cópia drafts -> bucket público, RPC interna e limpeza, com falhas parciais.
let handler
let fake
const DRAFTS = 'exercise-visual-drafts'
const PUBLIC = 'exercise-visuals'
const draft = (file) => `${CATALOG}/${SET}/${file}`
const published = (file) => `${CATALOG}/v3/${file}`
const FILES = { start: 'start.webp', end: 'end.webp', thumbnail: 'thumb.webp' }

before(async () => {
  handler = await loadHandler(new URL('./index.ts', import.meta.url))
})

function arrange({
  roles = ['start', 'end', 'thumbnail'],
  confirmed = roles,
  overrides = {},
} = {}) {
  fake = resetFake(overrides)
  fake.tables.exercise_visual_sets[0].status = 'review'
  fake.tables.exercise_visual_assets = roles.map((role) => ({
    visual_set_id: SET,
    role,
    storage_bucket: DRAFTS,
    storage_path: draft(FILES[role]),
    mime_type: confirmed.includes(role) ? 'image/webp' : null,
    byte_size: confirmed.includes(role) ? 64 : null,
  }))
  for (const role of roles)
    fake.buckets[DRAFTS].set(
      draft(FILES[role]),
      makeWebp(role === 'thumbnail' ? 320 : 1024, role === 'thumbnail' ? 320 : 1024)
    )
  fake.rpcResult = () => ({ data: { version: 3, images: [] }, error: null })
}
beforeEach(() => arrange())

const call = async (body = { visualSetId: SET }, options) => {
  const response = await handler(post(body, options))
  return { status: response.status, body: await response.json() }
}

test('só superadmin publica: sem JWT 401, usuário comum 403, nenhum byte copiado', async () => {
  assert.equal((await call(undefined, { auth: null })).status, 401)
  fake.authUser = { id: USER }
  assert.equal((await call()).status, 403)
  assert.deepEqual([fake.uploads.length, fake.rpcCalls.length], [0, 0])
})

test('caminho feliz: copia start/end/thumbnail para {catalog}/v{versão}/, chama a RPC e limpa os rascunhos', async () => {
  const result = await call()
  assert.equal(result.status, 200)
  assert.deepEqual([...fake.buckets[PUBLIC].keys()].sort(), [
    published('end.webp'),
    published('start.webp'),
    published('thumb.webp'),
  ])
  assert.ok(
    fake.uploads.every(
      ([bucket, , options]) =>
        bucket === PUBLIC && options.contentType === 'image/webp' && options.upsert === false
    )
  )
  assert.deepEqual(fake.rpcCalls[0], [
    'publish_exercise_visual_internal',
    { p_set_id: SET, p_actor: SUPERADMIN },
  ])
  assert.equal(fake.buckets[DRAFTS].size, 0, 'rascunhos removidos depois da RPC')
  assert.ok(fake.rpcCalls.length === 1)
})

test('a ORDEM é cópia -> RPC -> limpeza: a RPC só roda com os 3 arquivos já no destino', async () => {
  let filesAtRpc = null
  fake.rpcResult = () => {
    filesAtRpc = fake.buckets[PUBLIC].size
    return { data: {}, error: null }
  }
  await call()
  assert.equal(filesAtRpc, 3)
})

test('miniatura ausente/não confirmada: publica só start/end (nada pela metade além disso)', async () => {
  arrange({ roles: ['start', 'end'] })
  assert.equal((await call()).status, 200)
  assert.deepEqual([...fake.buckets[PUBLIC].keys()].sort(), [
    published('end.webp'),
    published('start.webp'),
  ])

  arrange({ roles: ['start', 'end', 'thumbnail'], confirmed: ['start', 'end'] })
  assert.equal((await call()).status, 200)
  assert.ok(
    !fake.buckets[PUBLIC].has(published('thumb.webp')),
    'miniatura não confirmada nunca é publicada'
  )
  assert.ok(
    fake.removed[0][1].includes(draft('thumb.webp')),
    'e o arquivo avulso é limpo do rascunho'
  )
})

test('start ou end não confirmados: 400 INCOMPLETE_VISUAL_SET e nada é copiado', async () => {
  arrange({ roles: ['start', 'end', 'thumbnail'], confirmed: ['start', 'thumbnail'] })
  const result = await call()
  assert.deepEqual([result.status, result.body.error], [400, 'INCOMPLETE_VISUAL_SET'])
  assert.deepEqual([fake.uploads.length, fake.rpcCalls.length], [0, 0])
})

test('estado inválido: só review publica (allocated/rejected/archived => 409); published => idempotente', async () => {
  for (const status of ['allocated', 'rejected', 'archived', 'failed']) {
    fake.tables.exercise_visual_sets[0].status = status
    const result = await call()
    assert.deepEqual([status, result.status, result.body.error], [status, 409, 'INVALID_STATE'])
  }
  fake.tables.exercise_visual_sets[0].status = 'published'
  const again = await call()
  assert.equal(again.status, 200)
  assert.equal(again.body.alreadyPublished, true)
  assert.deepEqual(again.body.publishedMediaRefs, { version: 3, images: [] })
  assert.deepEqual([fake.uploads.length, fake.rpcCalls.length], [0, 0])
})

test('path adulterado no banco (traversal, outro conjunto, bucket errado): 409 e nada é baixado/copiado/publicado', async () => {
  for (const evil of [
    '../x/start.webp',
    `${CATALOG}/${SET}/../start.webp`,
    `${CATALOG}/dddddddd-dddd-4ddd-8ddd-dddddddddddd/start.webp`,
  ]) {
    arrange()
    fake.tables.exercise_visual_assets.find((a) => a.role === 'start').storage_path = evil
    const result = await call()
    assert.deepEqual([evil, result.status, result.body.error], [evil, 409, 'INVALID_STATE'])
    assert.ok(!fake.downloads.some(([, p]) => p === evil))
    assert.equal(fake.rpcCalls.length, 0)
  }
  arrange()
  fake.tables.exercise_visual_assets.find((a) => a.role === 'end').storage_bucket = PUBLIC
  assert.equal((await call()).body.error, 'INVALID_STATE')
})

test('rascunho ausente ou corrompido: erro claro, a RPC NÃO roda e o conjunto continua em review', async () => {
  arrange()
  fake.buckets[DRAFTS].delete(draft('end.webp'))
  assert.deepEqual((await call()).body, { error: 'MISSING_FILE' })
  arrange()
  fake.buckets[DRAFTS].set(draft('end.webp'), new TextEncoder().encode('<html>'.padEnd(64, ' ')))
  assert.deepEqual((await call()).body, { error: 'INVALID_IMAGE' })
  arrange()
  fake.buckets[DRAFTS].set(
    draft('start.webp'),
    makeWebp(1024, 1024, { truncateTo: 40, riffSize: 56 })
  )
  assert.deepEqual((await call()).body, { error: 'INVALID_IMAGE' })
  assert.equal(fake.rpcCalls.length, 0)
  assert.equal(fake.tables.exercise_visual_sets[0].status, 'review')
})

test('falha de cópia (Storage): 502 COPY_FAILED, sem RPC e sem apagar rascunhos (pode repetir)', async () => {
  fake.fail.upload = (bucket, path) =>
    path === published('end.webp') ? { statusCode: '500', message: 'storage down' } : null
  const result = await call()
  assert.deepEqual([result.status, result.body.error], [502, 'COPY_FAILED'])
  assert.equal(fake.rpcCalls.length, 0)
  assert.equal(fake.buckets[DRAFTS].size, 3)
  // repetir depois que o Storage volta: o start já copiado ("já existe") é aceito e tudo conclui
  fake.fail.upload = null
  const retry = await call()
  assert.equal(retry.status, 200)
  assert.equal(fake.buckets[PUBLIC].size, 3)
  assert.equal(fake.rpcCalls.length, 1)
})

test('destino que não aparece depois do upload: COPY_FAILED (nunca publica apontando para arquivo ausente)', async () => {
  fake.fail.exists = true
  assert.equal((await call()).body.error, 'COPY_FAILED')
  assert.equal(fake.rpcCalls.length, 0)
})

test('RPC falha depois da cópia: erro, conjunto continua em review, rascunhos preservados, repetir publica', async () => {
  fake.rpcResult = () => ({ data: null, error: { message: 'INVALID_STATE' } })
  const failed = await call()
  assert.deepEqual([failed.status, failed.body.error], [409, 'INVALID_STATE'])
  assert.equal(fake.buckets[DRAFTS].size, 3)
  assert.equal(
    fake.buckets[PUBLIC].size,
    3,
    'arquivos órfãos no público são inofensivos: nada aponta para eles'
  )
  assert.equal(fake.tables.exercise_visual_sets[0].status, 'review')
  fake.rpcResult = () => ({ data: {}, error: null })
  assert.equal((await call()).status, 200)
})

test('erro desconhecido da RPC não vaza detalhe interno', async () => {
  fake.rpcResult = () => ({ data: null, error: { message: 'relation "x" does not exist' } })
  assert.deepEqual((await call()).body, { error: 'INTERNAL_ERROR' })
})

test('falha na limpeza dos rascunhos não desfaz nem esconde a publicação', async () => {
  fake.fail.remove = true
  const result = await call()
  assert.equal(result.status, 200)
  assert.equal(fake.rpcCalls.length, 1)
})

test('V2 integridade: rascunho com o SHA-256 gravado na confirmação publica; hash divergente => 409 e nada copiado', async () => {
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
  for (const asset of fake.tables.exercise_visual_assets) {
    const file = asset.storage_path.split('/').pop()
    asset.sha256 = sha(fake.buckets[DRAFTS].get(draft(file)))
  }
  assert.equal((await call()).status, 200, 'hash confere => publica')

  arrange()
  for (const asset of fake.tables.exercise_visual_assets) asset.sha256 = 'a'.repeat(64)
  const result = await call()
  assert.deepEqual([result.status, result.body.error], [409, 'INTEGRITY_MISMATCH'])
  assert.deepEqual([fake.uploads.length, fake.rpcCalls.length], [0, 0])
})

test('V2: conjunto confirmado pela v1 (sem sha256) continua publicando', async () => {
  fake.tables.exercise_visual_assets.forEach((asset) => (asset.sha256 = null))
  assert.equal((await call()).status, 200)
})

test('V2: EXIF/XMP no rascunho é recusado também na publicação (defesa em profundidade)', async () => {
  for (const chunk of ['EXIF', 'XMP ']) {
    arrange()
    fake.buckets[DRAFTS].set(draft('start.webp'), makeWebp(1024, 1024, { chunk }))
    const result = await call()
    assert.deepEqual([chunk, result.status, result.body.error], [chunk, 400, 'INVALID_IMAGE'])
    assert.deepEqual([fake.uploads.length, fake.rpcCalls.length], [0, 0])
  }
})

test('V2: transição inválida barrada pelo banco chega como 409 INVALID_TRANSITION', async () => {
  fake.rpcResult = () => ({ data: null, error: { message: 'INVALID_TRANSITION' } })
  const result = await call()
  assert.deepEqual([result.status, result.body.error], [409, 'INVALID_TRANSITION'])
})

// The shared administrative authenticator must fail closed before touching Storage or RPCs.
test('sessão revogada ou consulta indisponível: 401 sem operações privilegiadas', async () => {
  for (const unavailable of [false, true]) {
    arrange()
    fake.sessionActive = unavailable ? true : false
    fake.fail.session = unavailable
    const result = await call()
    assert.deepEqual([result.status, result.body.error], [401, 'SESSION_REVOKED'])
    assert.deepEqual(fake.authRpcCalls, ['is_session_active'])
    assert.deepEqual([fake.rpcCalls.length, fake.downloads.length, fake.uploads.length, fake.removed.length], [0, 0, 0, 0])
  }
})

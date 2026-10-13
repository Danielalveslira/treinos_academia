import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let service

// supabase/config.js e imageCompression (canvas) não existem em node --test: são trocados por fakes
// controláveis via globalThis (mesmo padrão de exerciseCatalogService.test.js).
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'exercise-visuals-service-'))
  const outfile = join(directory, 'service.cjs')
  await build({
    stdin: {
      contents: "export * as service from './exerciseVisualsService.js'",
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    bundle: true,
    outfile,
    platform: 'node',
    format: 'cjs',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"https://proj.supabase.co"' },
    plugins: [
      {
        name: 'stubs',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/supabase\/config$/ }, (args) => ({
            path: args.path,
            namespace: 'supabase-stub',
          }))
          pluginBuild.onResolve({ filter: /\/utils\/imageCompression$/ }, (args) => ({
            path: args.path,
            namespace: 'compress-stub',
          }))
          pluginBuild.onResolve({ filter: /\/utils\/perceptualHash$/ }, (args) => ({
            path: args.path,
            namespace: 'phash-stub',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'phash-stub' }, () => ({
            contents: `
              export async function perceptualHashOfBlob(blob) {
                if (globalThis.__phash === 'throw') throw new Error('phash failed')
                return globalThis.__phash ? globalThis.__phash(blob.tag) : null
              }
            `,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'compress-stub' }, () => ({
            contents: `
              export async function compressImage(file, options) {
                globalThis.__calls.push({ kind: 'compress', name: file.name, options })
                if (globalThis.__compressFail && globalThis.__compressFail(options)) throw new Error('compress failed')
                return { size: file.size, type: 'image/webp', tag: file.name + '@' + options.maxDimension }
              }
            `,
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'supabase-stub' }, () => ({
            contents: `
              const record = (call) => { globalThis.__calls.push(call) }
              function builder(table, call) {
                const b = {}
                for (const method of ['select', 'eq', 'in', 'neq', 'order', 'range', 'ilike', 'is', 'not', 'limit']) {
                  b[method] = (...args) => { call.chain.push([method, ...args]); return b }
                }
                b.maybeSingle = () => Promise.resolve(globalThis.__single)
                b.then = (resolve) => resolve(globalThis.__query(table, call))
                return b
              }
              export const supabase = {
                auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-1' } }, error: null }) },
                rpc: async (name, params) => { record({ kind: 'rpc', name, params }); return globalThis.__rpc(name, params) },
                from: (table) => { const call = { kind: 'from', table, chain: [] }; record(call); return builder(table, call) },
                storage: {
                  from: (bucket) => ({
                    upload: async (path, blob, options) => { record({ kind: 'upload', bucket, path, blob, options }); return globalThis.__upload(path) },
                    createSignedUrls: async (paths, ttl) => { record({ kind: 'signed', bucket, paths, ttl }); return { data: paths.map((p) => ({ signedUrl: 'signed://' + p })), error: null } },
                    getPublicUrl: (path) => ({ data: { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/' + bucket + '/' + path } }),
                  }),
                },
              }
            `,
          }))
        },
      },
    ],
  })
  ;({ service } = require(outfile))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

const ALLOCATION = {
  visualSetId: 'set-1',
  version: 4,
  assets: {
    start: { id: 'a1', path: 'cat/set-1/start.webp' },
    end: { id: 'a2', path: 'cat/set-1/end.webp' },
    thumbnail: { id: 'a3', path: 'cat/set-1/thumb.webp' },
  },
}
const file = (name, size = 1000) => ({ name, size })
let fetchCalls

beforeEach(() => {
  globalThis.__calls = []
  globalThis.__compressFail = null
  globalThis.__phash = null
  globalThis.__query = () => ({ data: [], error: null, count: 0 })
  globalThis.__single = { data: null, error: null }
  globalThis.__rpc = async () => ({ data: ALLOCATION, error: null })
  globalThis.__upload = async () => ({ error: null })
  fetchCalls = []
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init })
    return { ok: true, json: async () => ({ visualSetId: 'set-1', status: 'review' }) }
  }
})

test('uploadVisualSet: converte, aloca, sobe nos paths reservados e confirma no servidor (nessa ordem)', async () => {
  const result = await service.uploadVisualSet({
    catalogId: 'cat',
    startFile: file('s.png'),
    endFile: file('e.png'),
    promptVersion: 'v2',
    metadata: { styleVersion: 'EVOLUTUS_FITNESS_V2' },
  })
  assert.deepEqual(result, { visualSetId: 'set-1', status: 'review' })

  const kinds = globalThis.__calls.map((call) => call.kind)
  assert.deepEqual(kinds, ['compress', 'compress', 'compress', 'rpc', 'upload', 'upload', 'upload'])
  const compress = globalThis.__calls.filter((call) => call.kind === 'compress')
  assert.deepEqual(
    compress.map((call) => call.options.maxDimension).sort((a, b) => a - b),
    [320, 1024, 1024]
  )
  assert.equal(compress.find((call) => call.options.maxDimension === 320).name, 's.png') // miniatura sai da posição inicial

  const rpc = globalThis.__calls.find((call) => call.kind === 'rpc')
  assert.equal(rpc.name, 'allocate_exercise_visual_set')
  assert.deepEqual(rpc.params, {
    p_catalog_id: 'cat',
    p_generation_source: 'manual_upload',
    p_prompt_version: 'v2',
    p_metadata: { styleVersion: 'EVOLUTUS_FITNESS_V2' },
    p_request_id: null,
    p_style_profile_id: null,
    p_prompt_start_hash: null,
    p_prompt_end_hash: null,
    p_provider_hint: null,
  })

  const uploads = globalThis.__calls.filter((call) => call.kind === 'upload')
  assert.deepEqual(
    uploads.map((call) => [call.bucket, call.path]),
    [
      ['exercise-visual-drafts', 'cat/set-1/start.webp'],
      ['exercise-visual-drafts', 'cat/set-1/end.webp'],
      ['exercise-visual-drafts', 'cat/set-1/thumb.webp'],
    ]
  )
  assert.ok(
    uploads.every(
      (call) => call.options.contentType === 'image/webp' && call.options.upsert === false
    )
  )
  assert.equal(uploads[2].blob.tag, 's.png@320')

  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].url, 'https://proj.supabase.co/functions/v1/exercise-visual-confirm')
  assert.equal(fetchCalls[0].init.headers.Authorization, 'Bearer jwt-1')
  assert.deepEqual(JSON.parse(fetchCalls[0].init.body), { visualSetId: 'set-1' })
})

test('uploadVisualSet exige as duas imagens e não aloca nada sem elas', async () => {
  await assert.rejects(
    () => service.uploadVisualSet({ catalogId: 'cat', startFile: file('s.png') }),
    { code: 'MISSING_FILES' }
  )
  assert.equal(
    globalThis.__calls.some((call) => call.kind === 'rpc'),
    false
  )
})

test('uploadVisualSet recusa imagem pesada ANTES de alocar', async () => {
  await assert.rejects(
    () =>
      service.uploadVisualSet({
        catalogId: 'cat',
        startFile: file('s.png', 3 * 1024 * 1024),
        endFile: file('e.png'),
      }),
    { code: 'IMAGE_TOO_LARGE' }
  )
  assert.equal(
    globalThis.__calls.some((call) => call.kind === 'rpc'),
    false
  )
})

test('uploadVisualSet para na falha do upload e não confirma', async () => {
  globalThis.__upload = async (path) =>
    path.endsWith('end.webp') ? { error: new Error('storage down') } : { error: null }
  await assert.rejects(
    () =>
      service.uploadVisualSet({
        catalogId: 'cat',
        startFile: file('s.png'),
        endFile: file('e.png'),
      }),
    /storage down/
  )
  assert.equal(fetchCalls.length, 0)
})

test('uploadVisualSet propaga erro da alocação (ex.: não é superadmin) sem subir arquivo', async () => {
  globalThis.__rpc = async () => ({ data: null, error: { code: '42501', message: 'FORBIDDEN' } })
  await assert.rejects(
    () =>
      service.uploadVisualSet({
        catalogId: 'cat',
        startFile: file('s.png'),
        endFile: file('e.png'),
      }),
    { message: 'FORBIDDEN' }
  )
  assert.equal(
    globalThis.__calls.some((call) => call.kind === 'upload'),
    false
  )
})

test('erro da Edge Function de confirmação vira Error com o código do servidor', async () => {
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'INVALID_IMAGE' }) })
  await assert.rejects(
    () =>
      service.uploadVisualSet({
        catalogId: 'cat',
        startFile: file('s.png'),
        endFile: file('e.png'),
      }),
    { code: 'INVALID_IMAGE' }
  )
})

test('publishVisualSet chama a Edge Function publish-exercise-visual com o JWT do admin', async () => {
  await service.publishVisualSet('set-9')
  assert.equal(fetchCalls[0].url, 'https://proj.supabase.co/functions/v1/publish-exercise-visual')
  assert.deepEqual(JSON.parse(fetchCalls[0].init.body), { visualSetId: 'set-9' })
})

test('rejectVisualSet e restoreVisualSet usam as RPCs (sem motivo vazio)', async () => {
  globalThis.__rpc = async () => ({ data: { ok: true }, error: null })
  await service.rejectVisualSet('set-1', '  anatomia errada  ')
  await service.rejectVisualSet('set-2', '   ')
  await service.restoreVisualSet('set-3')
  const rpcs = globalThis.__calls.filter((call) => call.kind === 'rpc')
  assert.deepEqual(
    rpcs.map((call) => [call.name, call.params]),
    [
      ['reject_exercise_visual_set', { p_set_id: 'set-1', p_reason: 'anatomia errada' }],
      ['reject_exercise_visual_set', { p_set_id: 'set-2', p_reason: null }],
      ['restore_exercise_visual_version', { p_set_id: 'set-3' }],
    ]
  )
})

test('listCatalogForVisuals: busca normalizada (sem acento/curingas) e filtro "sem imagem"', async () => {
  globalThis.__query = () => ({ data: [{ id: 'c1' }], error: null, count: 868 })
  const result = await service.listCatalogForVisuals({
    q: ' Extensão  de %Pé_ ',
    onlyMissing: true,
    limit: 20,
    offset: 40,
  })
  assert.deepEqual(result, { data: [{ id: 'c1' }], total: 868 })
  const chain = globalThis.__calls.find((call) => call.kind === 'from').chain
  assert.deepEqual(
    chain.find(([m]) => m === 'ilike'),
    ['ilike', 'name_normalized', '%extensao de pe%']
  )
  assert.deepEqual(
    chain.find(([m]) => m === 'is'),
    ['is', 'published_media_refs->version', null]
  )
  assert.deepEqual(
    chain.find(([m]) => m === 'range'),
    ['range', 40, 59]
  )
  assert.deepEqual(
    chain.find(([m]) => m === 'eq'),
    ['eq', 'is_active', true]
  )
})

test('listCatalogForVisuals sem filtros não aplica ilike nem is', async () => {
  await service.listCatalogForVisuals()
  const chain = globalThis.__calls.find((call) => call.kind === 'from').chain
  assert.equal(
    chain.some(([m]) => m === 'ilike' || m === 'is'),
    false
  )
})

test('getVisualCoverage calcula cobertura a partir das contagens', async () => {
  globalThis.__query = (_table, call) => ({
    data: null,
    error: null,
    count: call.chain.some(([m]) => m === 'not') ? 20 : 868,
  })
  const coverage = await service.getVisualCoverage()
  assert.equal(coverage.total, 868)
  assert.equal(coverage.published, 20)
  assert.equal(coverage.missing, 848)
  assert.equal(coverage.percent.toFixed(1), '2.3')
})

test('listVisualSets: URL pública para o que está publicado, assinada para rascunho em revisão, nenhuma para alocado', async () => {
  const asset = (role, bucket, path) => ({ role, storage_bucket: bucket, storage_path: path })
  globalThis.__query = () => ({
    error: null,
    data: [
      {
        id: 's3',
        status: 'review',
        assets: [
          asset('start', 'exercise-visual-drafts', 'c/s3/start.webp'),
          asset('end', 'exercise-visual-drafts', 'c/s3/end.webp'),
        ],
      },
      {
        id: 's2',
        status: 'published',
        assets: [asset('start', 'exercise-visuals', 'c/v2/start.webp')],
      },
      {
        id: 's1',
        status: 'allocated',
        assets: [asset('start', 'exercise-visual-drafts', 'c/s1/start.webp')],
      },
    ],
  })
  const sets = await service.listVisualSets('c')
  assert.deepEqual(sets[0].previewUrls, {
    start: 'signed://c/s3/start.webp',
    end: 'signed://c/s3/end.webp',
  })
  assert.deepEqual(sets[1].previewUrls, {
    start: 'https://proj.supabase.co/storage/v1/object/public/exercise-visuals/c/v2/start.webp',
  })
  assert.deepEqual(sets[2].previewUrls, {})
  const signed = globalThis.__calls.filter((call) => call.kind === 'signed')
  assert.equal(signed.length, 1)
  assert.equal(signed[0].ttl, 600)
})

test('describeVisualError prioriza o código do servidor e nunca vaza mensagem técnica', () => {
  assert.match(service.describeVisualError({ code: '42501', message: 'FORBIDDEN' }), /superadmin/)
  assert.match(
    service.describeVisualError({ code: 'INVALID_IMAGE', message: 'INVALID_IMAGE' }),
    /WebP/
  )
  assert.equal(
    service.describeVisualError(new Error('relation "x" does not exist')),
    'Não foi possível concluir a operação. Tente novamente.'
  )
})

test('miniatura é melhor-esforço: falha ao GERAR não impede o envio (só start/end sobem e o servidor confirma)', async () => {
  globalThis.__compressFail = (options) => options.maxDimension === 320
  const result = await service.uploadVisualSet({
    catalogId: 'cat',
    startFile: file('s.png'),
    endFile: file('e.png'),
  })
  assert.deepEqual(result, { visualSetId: 'set-1', status: 'review' })
  const uploads = globalThis.__calls.filter((call) => call.kind === 'upload')
  assert.deepEqual(
    uploads.map((call) => call.path),
    ['cat/set-1/start.webp', 'cat/set-1/end.webp']
  )
  assert.equal(fetchCalls.length, 1)
})

test('miniatura é melhor-esforço: falha ao ENVIAR também não impede a confirmação', async () => {
  globalThis.__upload = async (path) =>
    path.endsWith('thumb.webp') ? { error: new Error('thumb upload failed') } : { error: null }
  const result = await service.uploadVisualSet({
    catalogId: 'cat',
    startFile: file('s.png'),
    endFile: file('e.png'),
  })
  assert.equal(result.status, 'review')
  assert.equal(fetchCalls.length, 1)
})

test('start e end continuam obrigatórios: falha ao comprimir um deles aborta antes de alocar', async () => {
  globalThis.__compressFail = (options) => options.maxDimension === 1024
  await assert.rejects(
    () =>
      service.uploadVisualSet({
        catalogId: 'cat',
        startFile: file('s.png'),
        endFile: file('e.png'),
      }),
    /compress failed/
  )
  assert.equal(
    globalThis.__calls.some((call) => call.kind === 'rpc'),
    false
  )
})

test('erro MISSING_FILE do servidor tem mensagem própria', () => {
  assert.match(service.describeVisualError({ message: 'MISSING_FILE' }), /não chegou ao servidor/)
})

test('V2: envia chave de idempotência, perfil de estilo, hashes dos prompts START/END e provider hint na alocação', async () => {
  await service.uploadVisualSet({
    catalogId: 'cat',
    startFile: file('s.png'),
    endFile: file('e.png'),
    promptVersion: 'v2',
    requestId: '11111111-1111-4111-8111-111111111111',
    styleProfileId: 'profile-2',
    promptStartHash: 'a'.repeat(64),
    promptEndHash: 'b'.repeat(64),
    providerHint: 'generic',
  })
  const rpc = globalThis.__calls.find((call) => call.kind === 'rpc')
  assert.deepEqual(rpc.params, {
    p_catalog_id: 'cat',
    p_generation_source: 'manual_upload',
    p_prompt_version: 'v2',
    p_metadata: {},
    p_request_id: '11111111-1111-4111-8111-111111111111',
    p_style_profile_id: 'profile-2',
    p_prompt_start_hash: 'a'.repeat(64),
    p_prompt_end_hash: 'b'.repeat(64),
    p_provider_hint: 'generic',
  })
  assert.doesNotMatch(JSON.stringify(rpc.params), /key|token|secret/i, 'nenhum segredo vai junto')
})

test('V2: o dHash de start/end vai para a confirmação (só os que foram calculados) e nunca bloqueia o envio', async () => {
  globalThis.__phash = (tag) => (tag.startsWith('s.png@1024') ? 'f0f0f0f0f0f0f0f0' : null)
  await service.uploadVisualSet({
    catalogId: 'cat',
    startFile: file('s.png'),
    endFile: file('e.png'),
  })
  assert.deepEqual(JSON.parse(fetchCalls[0].init.body), {
    visualSetId: 'set-1',
    perceptualHashes: { start: 'f0f0f0f0f0f0f0f0' },
  })
  fetchCalls.length = 0
  globalThis.__phash = 'throw'
  const result = await service.uploadVisualSet({
    catalogId: 'cat',
    startFile: file('s.png'),
    endFile: file('e.png'),
  })
  assert.equal(result.status, 'review')
  assert.deepEqual(JSON.parse(fetchCalls[0].init.body), { visualSetId: 'set-1' })
})

test('V2: repetição de um envio que já passou do upload (conjunto em review) só reconfirma, sem subir de novo', async () => {
  globalThis.__rpc = async () => ({
    data: { ...ALLOCATION, status: 'review', replayed: true },
    error: null,
  })
  const result = await service.uploadVisualSet({
    catalogId: 'cat',
    startFile: file('s.png'),
    endFile: file('e.png'),
    requestId: '11111111-1111-4111-8111-111111111111',
  })
  assert.equal(result.status, 'review')
  assert.equal(globalThis.__calls.filter((call) => call.kind === 'upload').length, 0)
  assert.equal(fetchCalls.length, 1)
})

test('V2: retry depois de upload parcial: arquivo que já existe no Storage (409) não é erro; o envio conclui', async () => {
  globalThis.__rpc = async () => ({
    data: { ...ALLOCATION, status: 'allocated', replayed: true },
    error: null,
  })
  globalThis.__upload = async (path) =>
    path.endsWith('start.webp')
      ? { error: { statusCode: '409', message: 'The resource already exists' } }
      : { error: null }
  const result = await service.uploadVisualSet({
    catalogId: 'cat',
    startFile: file('s.png'),
    endFile: file('e.png'),
    requestId: '11111111-1111-4111-8111-111111111111',
  })
  assert.equal(result.status, 'review')
  const uploads = globalThis.__calls.filter((call) => call.kind === 'upload')
  assert.deepEqual(
    uploads.map((call) => call.path.split('/').pop()),
    ['start.webp', 'end.webp', 'thumb.webp']
  )
  assert.equal(fetchCalls.length, 1)
})

test('V2: classifica erros definitivos (nova alocação) x repetíveis (mesma chave) e gera chaves únicas', () => {
  for (const code of [
    'INVALID_IMAGE',
    'IMAGE_METADATA_NOT_ALLOWED',
    'UPLOAD_NOT_AUTHORIZED',
    'IDEMPOTENCY_KEY_REUSED',
  ])
    assert.equal(service.isDefinitiveUploadError({ code }), true, code)
  assert.equal(service.isDefinitiveUploadError({ message: 'INVALID_STATE' }), true)
  for (const error of [
    new TypeError('Failed to fetch'),
    { code: 'CONFIRM_FAILED' },
    { message: 'storage down' },
    null,
  ])
    assert.equal(service.isDefinitiveUploadError(error), false)
  const a = service.newUploadRequestId()
  const b = service.newUploadRequestId()
  assert.match(a, /^[0-9a-f-]{36}$/)
  assert.notEqual(a, b)
})

test('V2: mensagens novas (metadata EXIF/XMP, transição inválida, integridade) e o conjunto sem miniatura', () => {
  assert.match(service.describeVisualError({ message: 'IMAGE_METADATA_NOT_ALLOWED' }), /EXIF\/XMP/)
  assert.match(service.describeVisualError({ message: 'INVALID_TRANSITION' }), /não é permitida/)
  assert.match(
    service.describeVisualError({ message: 'INTEGRITY_MISMATCH' }),
    /mudou depois da validação/
  )
  assert.match(service.describeVisualError({ message: 'INCOMPLETE_VISUAL_SET' }), /início e fim/)
})

test('V2: listVisualSets lê a proveniência e não assina URL de rascunho já purgado', async () => {
  globalThis.__query = () => ({
    error: null,
    data: [
      {
        id: 's9',
        status: 'rejected',
        drafts_purged_at: '2026-10-10T00:00:00Z',
        assets: [
          {
            role: 'start',
            storage_bucket: 'exercise-visual-drafts',
            storage_path: 'c/s9/start.webp',
          },
        ],
      },
    ],
  })
  const sets = await service.listVisualSets('c')
  assert.deepEqual(sets[0].previewUrls, {})
  assert.equal(
    globalThis.__calls.some((call) => call.kind === 'signed'),
    false
  )
  const select = globalThis.__calls
    .find((call) => call.kind === 'from')
    .chain.find(([m]) => m === 'select')[1]
  for (const column of [
    'style_version',
    'provider_hint',
    'prompt_start_hash',
    'prompt_end_hash',
    'drafts_purged_at',
  ])
    assert.match(select, new RegExp(column))
  assert.doesNotMatch(select, /request_id/, 'a chave de idempotência não é exposta')
})

test('mensagem do perfil de estilo indisponível', () => {
  assert.equal(
    service.describeVisualError(new Error('STYLE_PROFILE_UNAVAILABLE')),
    'Não foi possível carregar o padrão visual. Tente novamente.'
  )
})

test('exclusão solicita transação autorizada antes do Storage; falha da Edge retorna pendência explícita', async () => {
  globalThis.__rpc = async () => ({ data: { status: 'pending' }, error: null })
  await service.deleteVisualSet('set-1')
  assert.equal(globalThis.__calls[0].name, 'request_exercise_visual_deletion')
  assert.ok(fetchCalls[0].url.endsWith('/delete-exercise-visual'))
  assert.equal(JSON.parse(fetchCalls[0].init.body).visualSetId, 'set-1')
  globalThis.fetch = async () => {
    throw new Error('Storage offline')
  }
  assert.deepEqual(await service.deleteVisualSet('set-1'), { complete: false, status: 'pending' })
  globalThis.__rpc = async () => ({ data: { status: 'complete' }, error: null })
  assert.deepEqual(await service.deleteVisualSet('set-1'), { complete: true, status: 'complete' })
})
test('exclusão bloqueada não invoca Storage; retry usa somente a tarefa já autorizada', async () => {
  globalThis.__rpc = async () => ({ data: null, error: new Error('VISUAL_FILE_REFERENCED') })
  await assert.rejects(service.deleteVisualSet('set-1'), /VISUAL_FILE_REFERENCED/)
  assert.equal(fetchCalls.length, 0)
  await service.retryVisualDeletion('set-1')
  assert.equal(fetchCalls.length, 1)
  assert.match(service.describeVisualError({ message: 'VISUAL_VERSION_PROTECTED' }), /protegidas/)
})
test('cache das URLs evita assinatura/download repetido; histórico é requisitado explicitamente', async () => {
  const rows = [
    {
      id: 'lazy',
      status: 'review',
      assets: [
        {
          role: 'start',
          storage_bucket: 'exercise-visual-drafts',
          storage_path: 'unique-lazy/start.webp',
        },
      ],
    },
  ]
  globalThis.__query = () => ({ data: rows, error: null })
  await service.listVisualSets('lazy')
  await service.listVisualSets('lazy')
  assert.equal(globalThis.__calls.filter((c) => c.kind === 'signed').length, 1)
  assert.ok(globalThis.__calls.some((c) => c.chain?.some(([op]) => op === 'in')))
  globalThis.__calls = []
  await service.listVisualSets('lazy', { history: true })
  assert.equal(
    globalThis.__calls.some((c) => c.chain?.some(([op]) => op === 'in')),
    false
  )
})

test('retry de upload de versão excluída exige nova chave, sem ressuscitar a versão', () => {
  assert.equal(service.isDefinitiveUploadError({ message: 'VISUAL_SET_DELETED' }), true)
  assert.equal(service.isDefinitiveUploadError({ message: 'Failed to fetch' }), false)
})

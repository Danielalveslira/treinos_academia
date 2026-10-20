import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// F1.2 (correção de falha silenciosa descoberta na tarefa de UI de conta bloqueada): um
// update filtrado pela policy communities_update (ex.: dono bloqueado -- has_app_access())
// não gera `error` nenhum no PostgREST, só afeta 0 linhas. Sem checar o retorno, a chamada
// "funcionava" silenciosamente mesmo sem alterar nada no banco -- CommunityDetail.jsx mostrava
// "Comunidade atualizada." mesmo quando a conta do dono tinha sido bloqueada entre o load da
// tela e o submit. updateCommunity/setCommunityActive agora pedem .select('id') e lançam
// PERMISSION_DENIED quando 0 linhas voltam.
let directory
let updateCommunity
let setCommunityActive
let uploadCommunityCover
let getCachedPhotoUrl
let clearPhotoCache
let affectedRows
let mapCommunityRow

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'communities-service-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export { updateCommunity, setCommunityActive, uploadCommunityCover, mapCommunityRow } from './communitiesService.js'
        export { getCachedPhotoUrl, clearPhotoCache } from '../utils/photoBlobCache.js'`,
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
              export const supabase = {
                storage: { from: (bucket) => ({ upload: async (path, blob, options) => {
                  globalThis.__upload = { bucket, path, blob, options }
                  return { error: null }
                } }) },
                from: (table) => ({ update: (patch) => ({ eq: (col, id) => ({
                select: (cols) => {
                  globalThis.__calls.push({ table, patch, col, id, cols })
                  return Promise.resolve({ data: globalThis.__rows, error: null })
                }
              }) }) }) }
            `,
          }))
          context.onResolve({ filter: /\/utils\/imageCompression(\.js)?$/ }, () => ({
            path: 'image-compression',
            namespace: 'fake-image',
          }))
          context.onLoad({ filter: /.*/, namespace: 'fake-image' }, () => ({
            contents: `export const compressImage = async () => new Blob(['cover'], { type: 'image/webp' })`,
          }))
        },
      },
    ],
  })
  ;({
    updateCommunity,
    setCommunityActive,
    uploadCommunityCover,
    getCachedPhotoUrl,
    clearPhotoCache,
    mapCommunityRow,
  } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  affectedRows = [{ id: 'c1' }]
  globalThis.__calls = []
  globalThis.__rows = affectedRows
})

test('updateCommunity sucede quando a linha é realmente afetada (dono ok)', async () => {
  await assert.doesNotReject(
    updateCommunity('c1', {
      name: 'Nova',
      description: '',
      iconName: 'x',
      isActive: true,
      postAccess: 'everyone',
    })
  )
  assert.equal(globalThis.__calls.length, 1)
  assert.equal(globalThis.__calls[0].cols, 'id')
})

test('ícone oficial segue no payload de atualização e no mapeamento da leitura', async () => {
  await updateCommunity('c1', {
    name: 'Oficial',
    iconName: 'evolutus',
    isActive: true,
    postAccess: 'everyone',
  })
  assert.equal(globalThis.__calls[0].patch.icon_name, 'evolutus')
  assert.equal(mapCommunityRow({ icon_name: 'evolutus' }).iconName, 'evolutus')
})

test('updateCommunity lança PERMISSION_DENIED quando a policy filtra tudo (dono bloqueado) -- 0 linhas, sem error do PostgREST', async () => {
  globalThis.__rows = []
  await assert.rejects(
    updateCommunity('c1', {
      name: 'Nova',
      description: '',
      iconName: 'x',
      isActive: true,
      postAccess: 'everyone',
    }),
    /PERMISSION_DENIED/
  )
})

test('setCommunityActive sucede quando a linha é afetada', async () => {
  await assert.doesNotReject(setCommunityActive('c1', false))
})

test('setCommunityActive lança PERMISSION_DENIED com 0 linhas afetadas', async () => {
  globalThis.__rows = []
  await assert.rejects(setCommunityActive('c1', false), /PERMISSION_DENIED/)
})

test('upload da capa mantém caminho determinístico e atualiza o cache após confirmação no banco', async () => {
  clearPhotoCache()
  const path = await uploadCommunityCover('c1', new Blob(['input'], { type: 'image/png' }))
  assert.equal(path, 'c1.webp')
  assert.equal(globalThis.__upload.bucket, 'community-covers')
  assert.equal(globalThis.__upload.path, path)
  assert.equal(globalThis.__upload.blob.type, 'image/webp')
  assert.deepEqual(globalThis.__upload.options, { contentType: 'image/webp', upsert: true })
  assert.ok(getCachedPhotoUrl(path)?.startsWith('blob:'))
  clearPhotoCache()
})

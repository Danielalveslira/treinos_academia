import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// "Compartilhar progresso" na comunidade: o card é publicado como FOTO normal (mesmo bucket/pipeline), com o
// metadado de progresso no próprio registro. Nada de SVG/base64 no banco: só photo_path + progress_*.
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'progress-photo-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export { createPhotoStatus, mapStatusRow } from './statusesService.js'; export const inserts = globalThis.__inserts`,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    define: {
      'import.meta.env': JSON.stringify({
        VITE_SUPABASE_URL: 'https://x.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'k',
      }),
    },
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
              globalThis.__inserts = []
              globalThis.__deleted = []
              export const supabase = {
                auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
                from: (table) => ({
                  insert: async (row) => { globalThis.__inserts.push({ table, row }); return { error: null } },
                  delete: () => ({ eq: (column, value) => { globalThis.__deleted.push(value); return Promise.resolve({}) } }),
                }),
              }
            `,
          }))
        },
      },
    ],
  })
  return createRequire(import.meta.url)(outfile)
}

const { createPhotoStatus, mapStatusRow, inserts } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const author = { id: 'u1', username: 'ana', role: 'user' }
const blob = { size: 1000, type: 'image/webp' }
// O upload real usa XMLHttpRequest (inexistente no Node): a promessa `done` falha e o registro é removido -- é o
// mesmo caminho de erro do app; aqui só interessa o INSERT.
async function create(extra) {
  inserts.length = 0
  const { done } = await createPhotoStatus('c1', author, {
    blob,
    caption: ' Semana concluída 💪 ',
    ...extra,
  })
  await assert.rejects(done)
  return inserts[0].row
}

test('a progress card is inserted as a normal photo status plus the progress metadata (no image data in the row)', async () => {
  const row = await create({
    progress: { kind: 'week', periodStart: '2026-09-28', periodEnd: '2026-10-04' },
  })
  assert.equal(row.type, 'photo')
  assert.match(row.photo_path, /^statusPhotos\/c1\/[0-9a-f-]{36}\.webp$/)
  assert.equal(row.photo_caption, 'Semana concluída 💪')
  assert.equal(row.progress_kind, 'week')
  assert.equal(row.progress_period_start, '2026-09-28')
  assert.equal(row.progress_period_end, '2026-10-04')
  assert.equal(JSON.stringify(row).includes('svg'), false)
  assert.equal(JSON.stringify(row).includes('base64'), false)
})

test('a regular photo never gets progress fields', async () => {
  const row = await create({})
  assert.equal('progress_kind' in row, false)
  assert.equal('progress_period_start' in row, false)
})

test('mapStatusRow exposes progress for progress cards and null for regular photos', () => {
  const base = {
    id: 's1',
    community_id: 'c1',
    author_id: 'u1',
    type: 'photo',
    photo_path: 'statusPhotos/c1/s1.webp',
    photo_caption: 'oi',
  }
  assert.deepEqual(
    mapStatusRow({
      ...base,
      progress_kind: 'month',
      progress_period_start: '2026-10-01',
      progress_period_end: '2026-10-31',
    }).progress,
    {
      kind: 'month',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    }
  )
  assert.equal(mapStatusRow(base).progress, null)
  assert.equal(mapStatusRow({ ...base, progress_kind: null }).progress, null)
  assert.equal(mapStatusRow({ ...base, type: 'text', text: 'x' }).progress, undefined)
})

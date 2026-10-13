import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// getSharedStatus resolve o alvo de um link #treino-/#publicacao- por ID canônico: uma única
// leitura em statuses filtrada por id + community_id, igual para qualquer tipo de publicação.
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'shared-status-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { getSharedStatus } from './statusesService.js'
        export { getSharedStatus }
        export const calls = globalThis.__calls
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    loader: { '.css': 'empty' },
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
              globalThis.__calls = []
              export const supabase = {
                from: (table) => {
                  const call = { table, filters: {} }
                  globalThis.__calls.push(call)
                  const builder = {
                    select: (columns) => { call.columns = columns; return builder },
                    eq: (column, value) => { call.filters[column] = value; return builder },
                    maybeSingle: async () => globalThis.__result(call),
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

const { getSharedStatus, calls } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const row = (type, extra = {}) => ({
  id: 'status-1',
  community_id: 'c1',
  author_id: 'u1',
  type,
  created_at: '2026-10-02T10:00:00Z',
  expires_at: '2026-10-03T10:00:00Z',
  ...extra,
})

function resolveWith(result) {
  calls.length = 0
  globalThis.__result = () => result
}

test('busca uma única publicação por id e comunidade, sem varrer o feed', async () => {
  resolveWith({ data: row('text', { text: 'Olá' }), error: null })
  const status = await getSharedStatus('status-1', 'c1')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].table, 'status_publications')
  assert.deepEqual(calls[0].filters, { id: 'status-1', community_id: 'c1' })
  assert.equal(status.id, 'status-1')
  assert.equal(status.text, 'Olá')
})

test('suporta Treino Marcado, conquista, enquete e foto pelo mesmo caminho', async () => {
  const cases = {
    workout: { workout_title: 'Pernas', workout_date: '2026-10-05T10:00:00Z' },
    achievement: { achievement_text: 'PR' },
    poll: { poll_question: 'Qual treino?', poll_options: [] },
    photo: { photo_caption: 'Foto' },
  }
  for (const [type, extra] of Object.entries(cases)) {
    resolveWith({ data: row(type, extra), error: null })
    const status = await getSharedStatus('status-1', 'c1')
    assert.equal(status.type, type)
    assert.equal(calls.length, 1)
  }
})

test('publicação inexistente, removida ou fora do alcance da RLS devolve null', async () => {
  resolveWith({ data: null, error: null })
  assert.equal(await getSharedStatus('missing', 'c1'), null)
})

test('erro do banco é propagado', async () => {
  resolveWith({ data: null, error: new Error('boom') })
  await assert.rejects(() => getSharedStatus('status-1', 'c1'), /boom/)
})

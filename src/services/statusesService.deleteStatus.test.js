import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// F1.2 (correção de falha silenciosa descoberta na tarefa de UI de conta bloqueada): um
// delete filtrado pela policy statuses_delete (ex.: dono de comunidade bloqueado moderando
// post de terceiro -- has_app_access()) não gera `error` nenhum no PostgREST, só afeta 0
// linhas. useCommunityFeed.js removia o post da tela e CommunityDetail.jsx mostrava
// "Publicação excluída." mesmo sem nada ter sido apagado de fato (o post reapareceria num
// reload). deleteStatus agora pede .select('id') e lança PERMISSION_DENIED com 0 linhas.
let directory
let deleteStatus
let affectedRows

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'statuses-service-delete-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export { deleteStatus } from './statusesService.js'`,
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
              export const supabase = { from: (table) => ({ delete: () => ({ eq: (col, id) => ({
                select: (cols) => {
                  globalThis.__calls.push({ table, col, id, cols })
                  return Promise.resolve({ data: globalThis.__rows, error: null })
                }
              }) }) }) }
            `,
          }))
        },
      },
    ],
  })
  ;({ deleteStatus } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  affectedRows = [{ id: 's1' }]
  globalThis.__calls = []
  globalThis.__rows = affectedRows
})

test('deleteStatus sucede quando a linha é realmente afetada', async () => {
  await assert.doesNotReject(deleteStatus('s1'))
  assert.equal(globalThis.__calls.length, 1)
  assert.equal(globalThis.__calls[0].table, 'statuses')
})

test('deleteStatus lança PERMISSION_DENIED quando a policy nega (0 linhas, sem error do PostgREST) -- nunca sucesso silencioso', async () => {
  globalThis.__rows = []
  await assert.rejects(deleteStatus('s1'), /PERMISSION_DENIED/)
})

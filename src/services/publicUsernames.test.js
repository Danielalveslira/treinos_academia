import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// listPublicUsernames: nomes públicos em lote (1 consulta a cada 40), null para quem não tem perfil.
let directory
let listPublicUsernames
const queries = []
let profiles = {}
let failWith = null

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'public-usernames-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export { listPublicUsernames } from './publicProfilesService.js'`,
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
              export const supabase = { from: (table) => ({ select: () => ({ in: (col, ids) => {
                globalThis.__q.push({ table, ids })
                if (globalThis.__fail) return Promise.resolve({ data: null, error: globalThis.__fail })
                const data = ids.filter((id) => id in globalThis.__p).map((id) => ({ user_id: id, username: globalThis.__p[id] }))
                return Promise.resolve({ data, error: null })
              } }) }) }
            `,
          }))
        },
      },
    ],
  })
  globalThis.__q = queries
  ;({ listPublicUsernames } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  queries.length = 0
  profiles = {}
  failWith = null
  globalThis.__p = profiles
  globalThis.__fail = failWith
})

test('devolve o username de cada usuário e null para quem não tem perfil ou username', async () => {
  profiles.u1 = 'ana'
  profiles.u2 = ''
  const result = await listPublicUsernames(['u1', 'u2', 'u3'])
  assert.deepEqual(result, { u1: 'ana', u2: null, u3: null })
})

test('ids repetidos/vazios são ignorados e 95 usuários viram 3 consultas (40/40/15), não 95', async () => {
  const ids = Array.from({ length: 95 }, (_, i) => `u${i}`)
  await listPublicUsernames([...ids, 'u0', null, ''])
  assert.deepEqual(
    queries.map((q) => q.ids.length),
    [40, 40, 15]
  )
  assert.equal((await listPublicUsernames([])).constructor, Object)
  assert.equal(queries.length, 3, 'lista vazia não consulta')
})

test('erro da consulta é lançado (o chamador decide cair para "Membro")', async () => {
  globalThis.__fail = new Error('rede caiu')
  await assert.rejects(() => listPublicUsernames(['u1']), /rede caiu/)
})

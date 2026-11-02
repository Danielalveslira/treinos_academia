import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Descanso padrão entre séries na conta: leitura junto com a linha de users (mapUserRow) e escrita só pela
// RPC set_default_rest_seconds, com o valor validado antes de sair do aparelho.

let directory
let mod

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'default-rest-tests-'))
  const outfile = join(directory, 'users.cjs')
  await build({
    stdin: {
      contents: `export { mapUserRow, setDefaultRestSeconds } from './usersService.js'`,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'supabase-stub',
        setup(ctx) {
          ctx.onResolve({ filter: /supabase\/config$/ }, () => ({
            path: 'supabase',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^supabase$/, namespace: 'stub' }, () => ({
            contents: `export const supabase = { rpc: (...a) => globalThis.__rpc(...a) }`,
          }))
        },
      },
    ],
  })
  mod = createRequire(import.meta.url)(outfile)
})

after(async () => {
  delete globalThis.__rpc
  if (directory) await rm(directory, { recursive: true, force: true })
})

let calls
beforeEach(() => {
  calls = []
  globalThis.__rpc = (name, args) => {
    calls.push({ name, args })
    return Promise.resolve({ error: null, data: args.p_seconds })
  }
})

test('mapUserRow: null = sem preferência; 0 é preservado; inválido vira sem preferência', () => {
  assert.equal(mod.mapUserRow({ id: 'a', default_rest_seconds: null }).defaultRestSeconds, null)
  assert.equal(
    mod.mapUserRow({ id: 'a' }).defaultRestSeconds,
    null,
    'coluna ausente (backend antigo)'
  )
  assert.equal(mod.mapUserRow({ id: 'a', default_rest_seconds: 0 }).defaultRestSeconds, 0)
  assert.equal(mod.mapUserRow({ id: 'a', default_rest_seconds: 120 }).defaultRestSeconds, 120)
  assert.equal(mod.mapUserRow({ id: 'a', default_rest_seconds: 5000 }).defaultRestSeconds, null)
})

test('setDefaultRestSeconds: envia só inteiros 0–900 para a RPC da própria conta', async () => {
  assert.equal(await mod.setDefaultRestSeconds(60), 60)
  assert.equal(await mod.setDefaultRestSeconds('0'), 0)
  assert.deepEqual(calls, [
    { name: 'set_default_rest_seconds', args: { p_seconds: 60 } },
    { name: 'set_default_rest_seconds', args: { p_seconds: 0 } },
  ])
  for (const invalid of [null, '', -1, 901, 1.5, 'abc'])
    await assert.rejects(mod.setDefaultRestSeconds(invalid), /INVALID_REST_SECONDS/)
  assert.equal(calls.length, 2, 'valor inválido não chega ao servidor')
})

test('setDefaultRestSeconds: erro do servidor é repassado (a tela mostra a falha)', async () => {
  globalThis.__rpc = () => Promise.resolve({ error: new Error('INVALID_REST_SECONDS'), data: null })
  await assert.rejects(mod.setDefaultRestSeconds(30), /INVALID_REST_SECONDS/)
})

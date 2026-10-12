import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Verifica o contrato do cliente com um Supabase fake; autorização real é testada
// separadamente no PostgreSQL em aud_01_aud_02_security_test.sql.
let directory
const calls = []
let responses = {}

async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'status-write-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export { createTextStatus, createPollStatus, createWorkoutStatus } from './statusesService.js'`,
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
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/supabase\/config(\.js)?$/ }, (args) => ({
            path: args.path,
            namespace: 'fake',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
            contents: `
              const query = (table) => {
                const call = { table, ops: [] }
                globalThis.__calls.push(call)
                const q = new Proxy({}, {
                  get(_, op) {
                    if (op === 'then') {
                      let r = globalThis.__responses[table] || { data: [], error: null }
                      if (typeof r === 'function') r = r(call)
                      return (resolve, reject) => Promise.resolve(r).then(resolve, reject)
                    }
                    return (...args) => { call.ops.push([op, ...args]); return q }
                  },
                })
                return q
              }
              export const supabase = { from: query }
            `,
          }))
        },
      },
    ],
  })
  globalThis.__calls = calls
  return createRequire(import.meta.url)(outfile)
}

const { createTextStatus, createPollStatus, createWorkoutStatus } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
beforeEach(() => {
  calls.length = 0
  responses = {}
  globalThis.__responses = responses
})

const author = { id: 'a1', username: 'forjado', role: 'superadmin' }
const forbidden = [
  'promoted',
  'promoted_until',
  'active_promotion_id',
  'positive_vote_count',
  'negative_vote_count',
  'comment_count',
  'created_at',
  'expires_at',
  'retention_mode',
  'comments_close_at',
]

test('criação conserva dicas legadas de autoria sem enviar metadados financeiros', async () => {
  responses.statuses = { data: { id: 's1' }, error: null }
  await createTextStatus('c1', author, '  texto  ')
  await createPollStatus('c1', author, ' pergunta ', [' A ', ' B '])
  await createWorkoutStatus('c1', author, {
    title: ' treino ',
    date: '2026-10-12',
    location: ' local ',
  })
  assert.equal(calls.length, 3)
  const payloads = calls.map((call) => call.ops.find(([op]) => op === 'insert')[1])
  for (const payload of payloads) {
    assert.equal(payload.author_id, 'a1')
    assert.equal(payload.community_id, 'c1')
    assert.equal(payload.author_username, 'forjado')
    assert.equal(payload.author_is_superadmin, true)
    for (const column of forbidden) assert.equal(Object.hasOwn(payload, column), false, column)
  }
  assert.equal(payloads[0].text, 'texto')
  assert.deepEqual(payloads[1].poll_options, [
    { id: '0', label: 'A' },
    { id: '1', label: 'B' },
  ])
  assert.equal(payloads[2].workout_title, 'treino')
})

test('erro de autorização do banco chega ao chamador', async () => {
  const error = { code: '42501', message: 'permission denied' }
  responses.statuses = { data: null, error }
  await assert.rejects(createTextStatus('c1', author, 'texto'), (value) => value === error)
})

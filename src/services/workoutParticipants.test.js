import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Regressão de "Quem vai participar" (PGRST200): status_participants e public_profiles só se ligam a
// users -- não existe FK entre eles, então o embed `public_profiles(username)` nunca pode funcionar, e a
// RLS de status_participants só mostra a própria linha. O serviço agora usa as RPCs
// list_workout_participants/count_workout_participants (security definer, fail-closed no banco).
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'workout-participants-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { listWorkoutParticipants, countParticipants } from './statusesService.js'
        export { listWorkoutParticipants, countParticipants }
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
                rpc: async (name, args) => {
                  globalThis.__calls.push({ kind: 'rpc', name, args })
                  return globalThis.__rpcResult(name, args)
                },
                from: (table) => {
                  globalThis.__calls.push({ kind: 'from', table })
                  throw new Error('leitura direta de ' + table + ' não deve acontecer')
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

const { listWorkoutParticipants, countParticipants, calls } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
const reset = (result) => {
  calls.length = 0
  globalThis.__rpcResult = result
}

test('listWorkoutParticipants calls the RPC (never status_participants directly, never an embed) with the cursor split in two params', async () => {
  reset(async () => ({
    data: {
      participants: [{ userId: 'u1', username: 'ana' }],
      nextCursor: { at: '2026-10-02T10:00:00Z', userId: 'u1' },
    },
    error: null,
  }))
  const first = await listWorkoutParticipants('s1')
  assert.deepEqual(first.participants, [{ userId: 'u1', username: 'ana' }])
  assert.deepEqual(first.nextCursor, { at: '2026-10-02T10:00:00Z', userId: 'u1' })
  assert.deepEqual(calls[0], {
    kind: 'rpc',
    name: 'list_workout_participants',
    args: { p_status_id: 's1', p_cursor_at: null, p_cursor_user: null, p_limit: 20 },
  })
  await listWorkoutParticipants('s1', { cursor: first.nextCursor, limit: 5 })
  assert.deepEqual(calls[1].args, {
    p_status_id: 's1',
    p_cursor_at: '2026-10-02T10:00:00Z',
    p_cursor_user: 'u1',
    p_limit: 5,
  })
  assert.equal(
    calls.some((call) => call.kind === 'from'),
    false
  )
})

test('empty or null RPC payloads become an empty list (never crash the dialog); deleted accounts simply are not listed', async () => {
  for (const data of [null, undefined, {}, { participants: [], nextCursor: null }]) {
    reset(async () => ({ data, error: null }))
    assert.deepEqual(await listWorkoutParticipants('s1'), { participants: [], nextCursor: null })
  }
})

test('a participant without public profile arrives with username null (the dialog renders "Membro")', async () => {
  reset(async () => ({
    data: { participants: [{ userId: 'u2', username: null }], nextCursor: null },
    error: null,
  }))
  const result = await listWorkoutParticipants('s1')
  assert.equal(result.participants[0].username, null)
})

test('RPC errors (PERMISSION_DENIED, STATUS_NOT_FOUND) propagate so the dialog shows its retry state', async () => {
  reset(async () => ({
    data: null,
    error: Object.assign(new Error('PERMISSION_DENIED'), { code: 'P0001' }),
  }))
  await assert.rejects(() => listWorkoutParticipants('s1'), /PERMISSION_DENIED/)
  await assert.rejects(() => countParticipants('s1'), /PERMISSION_DENIED/)
})

test('countParticipants uses the real-count RPC and treats null as 0', async () => {
  reset(async () => ({ data: 7, error: null }))
  assert.equal(await countParticipants('s1'), 7)
  assert.deepEqual(calls[0], {
    kind: 'rpc',
    name: 'count_workout_participants',
    args: { p_status_id: 's1' },
  })
  reset(async () => ({ data: null, error: null }))
  assert.equal(await countParticipants('s1'), 0)
})

test('the frontend never embeds public_profiles into status_participants again', async () => {
  const source = await readFile(new URL('./statusesService.js', import.meta.url), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(code, /select\([^)]*public_profiles\(/)
  assert.doesNotMatch(code, /from\('status_participants'\)\s*\n?\s*\.select\('user_id, joined_at/)
})

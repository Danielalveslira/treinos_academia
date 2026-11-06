import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let uploadProfileAvatar
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'avatar-service-test-'))
  const outfile = join(directory, 'service.cjs')
  await build({
    entryPoints: [new URL('./profileAvatarService.js', import.meta.url).pathname],
    outfile,
    platform: 'node',
    format: 'cjs',
    bundle: true,
    logLevel: 'silent',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"https://example.test"' },
    plugins: [
      {
        name: 'supabase-stub',
        setup(ctx) {
          ctx.onResolve({ filter: /\.\.\/supabase\/config$/ }, () => ({
            path: 'supabase',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents:
              'export const supabase = new Proxy({}, { get: (_, key) => globalThis.__avatarSupabase[key] })',
            loader: 'js',
          }))
        },
      },
    ],
  })
  ;({ uploadProfileAvatar } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  delete globalThis.__avatarSupabase
  delete globalThis.fetch
})

function setup({ session = true, uploadError = null, confirmError = null } = {}) {
  const calls = []
  const current = session ? { access_token: 'token', user: { id: 'owner' } } : null
  globalThis.__avatarSupabase = {
    auth: { getSession: async () => ({ data: { session: current }, error: null }) },
    rpc: async (name) => {
      calls.push(['rpc', name])
      return { data: { mediaId: 'media-1', path: 'owner/media-1.webp' }, error: null }
    },
    storage: {
      from: () => ({
        upload: async (path, blob, options) => {
          calls.push(['upload', path, blob, options])
          return { error: uploadError }
        },
      }),
    },
  }
  globalThis.fetch = async (_url, options) => {
    calls.push(['confirm', options])
    return {
      ok: !confirmError,
      status: confirmError ? 403 : 200,
      json: async () =>
        confirmError ? { error: confirmError } : { path: 'owner/media-1.webp', mediaId: 'media-1' },
    }
  }
  return calls
}

test('sem sessão não aloca nem envia bytes', async () => {
  const calls = setup({ session: false })
  await assert.rejects(
    uploadProfileAvatar(new Blob(['x'], { type: 'image/webp' })),
    /NOT_AUTHENTICATED/
  )
  assert.deepEqual(calls, [])
})

test('envia WebP uma vez sem upsert e confirma com token do dono', async () => {
  const calls = setup()
  const blob = new Blob(['x'], { type: 'image/webp' })
  const result = await uploadProfileAvatar(blob)
  assert.equal(result.path, 'owner/media-1.webp')
  assert.equal(calls[1][2], blob)
  assert.equal(calls[1][3].upsert, false)
  assert.equal(calls[2][1].headers.Authorization, 'Bearer token')
})

test('falha de upload não confirma; nova tentativa aloca de novo', async () => {
  const calls = setup({ uploadError: new Error('offline') })
  const blob = new Blob(['x'], { type: 'image/webp' })
  await assert.rejects(uploadProfileAvatar(blob), /offline/)
  assert.equal(
    calls.some(([name]) => name === 'confirm'),
    false
  )
  setup()
  await uploadProfileAvatar(blob)
})

test('resposta perdida repete apenas a confirmação da mesma mídia', async () => {
  const calls = setup()
  let confirmations = 0
  globalThis.fetch = async (_url, options) => {
    calls.push(['confirm', options])
    confirmations += 1
    if (confirmations === 1) throw new Error('network lost')
    return { ok: true, status: 200, json: async () => ({ mediaId: 'media-1', path: 'owner/media-1.webp' }) }
  }
  const result = await uploadProfileAvatar(new Blob(['x'], { type: 'image/webp' }))
  assert.equal(result.path, 'owner/media-1.webp')
  assert.equal(calls.filter(([name]) => name === 'rpc').length, 1)
  assert.equal(calls.filter(([name]) => name === 'upload').length, 1)
  assert.equal(confirmations, 2)
})

test('negação explícita de permissão não é repetida', async () => {
  const calls = setup({ confirmError: 'APP_ACCESS_DENIED' })
  await assert.rejects(uploadProfileAvatar(new Blob(['x'], { type: 'image/webp' })), /APP_ACCESS_DENIED/)
  assert.equal(calls.filter(([name]) => name === 'confirm').length, 1)
})

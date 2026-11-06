import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const mediaId = '11111111-1111-4111-8111-111111111111'
let directory
let handler

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'avatar-confirm-test-'))
  globalThis.Deno = {
    env: { get: (key) => ({ SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] },
    serve: (callback) => { handler = callback },
  }
  const outfile = join(directory, 'confirm.cjs')
  await build({ entryPoints: [new URL('./index.ts', import.meta.url).pathname], outfile,
    platform: 'node', format: 'cjs', bundle: true, logLevel: 'silent',
    plugins: [{ name: 'supabase-stub', setup(ctx) {
      ctx.onResolve({ filter: /^jsr:/ }, () => ({ path: 'client', namespace: 'stub' }))
      ctx.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const createClient = (...args) => globalThis.__makeAvatarClient(...args)', loader: 'js' }))
    } }] })
  createRequire(import.meta.url)(outfile)
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  delete globalThis.Deno
  delete globalThis.__makeAvatarClient
})

function setup({ access = true, state = 'active', current = mediaId } = {}) {
  const calls = []
  globalThis.__makeAvatarClient = (_url, key) => {
    if (key === 'anon') return {
      auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
      rpc: async (name) => { calls.push(name); return { data: access, error: null } },
    }
    return {
      from: (table) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: table === 'users' ? { avatar_media_id: current } : { id: mediaId, owner_id: 'owner', storage_path: 'owner/avatar.webp', state }, error: null,
      }) }) }) }),
      storage: { from: () => ({ download: async () => { throw new Error('unexpected download') } }) },
    }
  }
  return calls
}

function request(auth = true) {
  return new Request('https://example.test/functions/v1/profile-avatar-confirm', {
    method: 'POST',
    headers: auth ? { Authorization: 'Bearer user-token' } : {},
    body: JSON.stringify({ mediaId }),
  })
}

test('sem token não consulta usuário nem mídia', async () => {
  const calls = setup()
  const response = await handler(request(false))
  assert.equal(response.status, 401)
  assert.deepEqual(calls, [])
})

test('conta sem acesso não confirma mídia previamente alocada', async () => {
  const calls = setup({ access: false, state: 'allocated' })
  const response = await handler(request())
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error, 'APP_ACCESS_DENIED')
  assert.deepEqual(calls, ['has_app_access'])
})

test('confirmação repetida retorna a mesma mídia somente enquanto ela for a foto ativa', async () => {
  setup()
  const response = await handler(request())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { mediaId, path: 'owner/avatar.webp' })
  setup({ current: null })
  const stale = await handler(request())
  assert.equal(stale.status, 403)
})

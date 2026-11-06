import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

let directory
let check
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'home-redirect-'))
  const outfile = join(directory, 'redirect.cjs')
  await build({
    entryPoints: [new URL('./publicHomeRedirect.js', import.meta.url).pathname],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
    plugins: [
      {
        name: 'supabase-stub',
        setup(context) {
          context.onResolve({ filter: /supabase\/config$/ }, () => ({
            path: 'supabase',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents:
              'export const supabase = { auth: { getSession: (...args) => globalThis.__homeAuth.getSession(...args), getUser: (...args) => globalThis.__homeAuth.getUser(...args) } }',
            loader: 'js',
          }))
        },
      },
    ],
  })
  globalThis.window = {
    location: {
      pathname: '/',
      replace(path) {
        globalThis.__homeDestination = path
      },
    },
    evolutusReleaseHomeAuth() {
      globalThis.__homeReleased = 'home-auth-pending'
    },
  }
  globalThis.document = {
    documentElement: {
      classList: {
        remove(name) {
          globalThis.__homeReleased = name
        },
      },
    },
  }
  await import(outfile)
  check = globalThis.window.evolutusRedirectHome
})
after(async () => {
  delete globalThis.window
  delete globalThis.document
  delete globalThis.__homeAuth
  if (directory) await rm(directory, { recursive: true, force: true })
})

async function run(session, user, pathname = '/') {
  const calls = []
  globalThis.__homeDestination = null
  globalThis.__homeReleased = null
  window.location.pathname = pathname
  globalThis.__homeAuth = {
    getSession: async () => {
      calls.push('session')
      return { data: { session }, error: null }
    },
    getUser: async () => {
      calls.push('user')
      return { data: { user }, error: null }
    },
  }
  await check()
  return calls
}

test('sessão válida na Home segue uma vez para /app sem revelar a Home', async () => {
  assert.deepEqual(await run({ access_token: 'token' }, { id: 'u1' }), ['session', 'user'])
  assert.equal(globalThis.__homeDestination, '/app')
  assert.equal(globalThis.__homeReleased, null)
})

test('chave local sem sessão ou usuário válido libera a Home', async () => {
  assert.deepEqual(await run(null, null), ['session'])
  assert.equal(globalThis.__homeDestination, null)
  assert.equal(globalThis.__homeReleased, 'home-auth-pending')
  assert.deepEqual(await run({ access_token: 'invalid' }, null), ['session', 'user'])
  assert.equal(globalThis.__homeDestination, null)
  assert.equal(globalThis.__homeReleased, 'home-auth-pending')
})

test('resposta atrasada depois de sair da Home não redireciona', async () => {
  await run({ access_token: 'token' }, { id: 'u1' }, '/como-funciona')
  assert.equal(globalThis.__homeDestination, null)
  assert.equal(globalThis.__homeReleased, 'home-auth-pending')
})

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

let directory
const handlers = {}
let confirmed
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'finance-handlers-'))
  const require = createRequire(import.meta.url)
  for (const name of ['infinitepay-webhook', 'infinitepay-check-payment', 'infinitepay-create-checkout', 'infinitepay-admin-reconcile']) {
    const outfile = join(directory, name + '.cjs')
    await build({ entryPoints: [new URL(`../${name}/index.ts`, import.meta.url).pathname], outfile,
      bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'synthetic-auth', setup(builder) {
        builder.onResolve({ filter: /^jsr:/ }, () => ({ path: 'supabase', namespace: 'synthetic' }))
        builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({ contents: `export function createClient() { return globalThis.__financeClient }` }))
      } }] })
    globalThis.Deno = { env: { get: (key) => ({ SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_ANON_KEY: 'synthetic', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', INFINITEPAY_HANDLE: 'synthetic' })[key] }, serve: (fn) => { handlers[name] = fn } }
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { role: 'superadmin' } }) }
    globalThis.__financeClient = { auth: { getUser: async () => ({ data: { user: null } }) }, from: () => query,
      rpc: async () => { confirmed++; throw new Error('unexpected financial side effect') } }
    require(outfile)
  }
})
after(async () => { delete globalThis.Deno; delete globalThis.__financeClient; await rm(directory, { recursive: true, force: true }) })

test('all four financial handlers reject unsupported methods before any financial side effect', async () => {
  confirmed = 0
  for (const handler of Object.values(handlers)) {
    assert.equal((await handler(new Request('https://synthetic.invalid', { method: 'GET' }))).status, 405)
  }
  assert.equal(confirmed, 0)
})
test('authenticated endpoints reject missing credentials, and webhook bounds actual bytes', async () => {
  confirmed = 0
  for (const name of ['infinitepay-check-payment', 'infinitepay-create-checkout', 'infinitepay-admin-reconcile']) {
    assert.equal((await handlers[name](new Request('https://synthetic.invalid', { method: 'POST', body: '{}' }))).status, 401)
  }
  const oversized = new Request('https://synthetic.invalid', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(17000) }) })
  assert.equal((await handlers['infinitepay-webhook'](oversized)).status, 413)
  assert.equal((await handlers['infinitepay-webhook'](new Request('https://synthetic.invalid', { method: 'POST', body: '{' }))).status, 400)
  assert.equal(confirmed, 0)
})

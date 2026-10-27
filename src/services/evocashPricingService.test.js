import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let dir, service
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'evocash-pricing-service-'))
  await build({
    entryPoints: [new URL('./evocashPricingService.js', import.meta.url).pathname],
    outfile: join(dir, 'service.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'supabase-fixture',
        setup(b) {
          b.onResolve({ filter: /\/supabase\/config$/ }, () => ({
            path: 'client',
            namespace: 'fixture',
          }))
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export const supabase = globalThis.__pricingClient',
            loader: 'js',
          }))
        },
      },
    ],
  })
  globalThis.__pricingClient = {
    rpc: async (name, args) => {
      globalThis.__pricingCalls.push({ name, args })
      return { data: { ok: true }, error: null }
    },
    auth: {
      getUser: async () => ({
        data: { user: { id: 'admin', email: 'local@example.invalid' } },
        error: null,
      }),
      signInWithPassword: async (args) => {
        globalThis.__pricingAuth = args
        return { data: { user: { id: 'admin' } }, error: null }
      },
    },
  }
  service = await import(join(dir, 'service.mjs'))
})
after(async () => {
  delete globalThis.__pricingClient
  delete globalThis.__pricingCalls
  delete globalThis.__pricingAuth
  await rm(dir, { recursive: true, force: true })
})
test('quote uses quantity and idempotency key only; never submits an authoritative total', async () => {
  globalThis.__pricingCalls = []
  await service.createEvoCashQuote('1000000', 'request-id')
  assert.deepEqual(globalThis.__pricingCalls, [
    {
      name: 'create_evocash_purchase_quote',
      args: { p_quantity: '1000000', p_request_id: 'request-id' },
    },
  ])
})
test('publication preserves exact strings and revision; reauthentication password never reaches RPC', async () => {
  globalThis.__pricingCalls = []
  await service.reauthenticatePricingAdmin('synthetic-password')
  await service.publishEvoCashPrice({
    config: { unitPriceCentavos: '29' },
    activeFrom: null,
    revision: '9007199254740993',
    requestId: 'id',
    reason: 'test reason',
    confirmLargeChange: false,
  })
  assert.equal(globalThis.__pricingAuth.password, 'synthetic-password')
  assert.equal(globalThis.__pricingCalls[0].args.p_expected_revision, '9007199254740993')
  assert.equal(globalThis.__pricingCalls[0].args.p_config.unitPriceCentavos, '29')
  assert.doesNotMatch(JSON.stringify(globalThis.__pricingCalls), /synthetic-password|password/)
})

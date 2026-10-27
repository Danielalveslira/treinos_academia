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
    entryPoints: [new URL('./commercialService.js', import.meta.url).pathname],
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
test('commercial quote and confirmation submit identifiers and consent, never client prices or wallet', async () => {
  globalThis.__pricingCalls = []
  await service.quoteCommercialOrder('resource', '7', 'request')
  await service.confirmCommercialOrder('order', true)
  assert.deepEqual(globalThis.__pricingCalls, [
    {
      name: 'quote_commercial_order',
      args: { p_resource_id: 'resource', p_duration_days: '7', p_request_id: 'request' },
    },
    { name: 'confirm_commercial_order', args: { p_order_id: 'order', p_confirm: true } },
  ])
})
test('commercial prices and compare-and-swap revisions retain exact strings', async () => {
  globalThis.__pricingCalls = []
  await service.publishCommercialPrice({
    code: 'service',
    price: '2147483647',
    minDays: '1',
    maxDays: '1',
    revision: '9007199254740993',
    requestId: 'request',
    reason: 'Test reason',
    confirm: true,
  })
  const args = globalThis.__pricingCalls[0].args
  assert.equal(args.p_unit_price_cash, '2147483647')
  assert.equal(args.p_expected_revision, '9007199254740993')
  assert.equal(args.p_min_days, 1)
  assert.doesNotMatch(JSON.stringify(args), /password|payer_user_id/)
})

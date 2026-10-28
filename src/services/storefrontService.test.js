import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let dir, service
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'storefront-service-'))
  await build({
    entryPoints: [new URL('./storefrontService.js', import.meta.url).pathname],
    outfile: join(dir, 'service.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'fake-client',
        setup(b) {
          b.onResolve({ filter: /\/supabase\/config$/ }, () => ({
            path: 'client',
            namespace: 'fake',
          }))
          b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
            contents: 'export const supabase=globalThis.__storefrontClient',
          }))
        },
      },
    ],
  })
  globalThis.__storefrontClient = {
    rpc: async (name, args) => {
      globalThis.__storefrontCalls.push({ name, args })
      return { data: { ok: true }, error: null }
    },
  }
  service = await import(join(dir, 'service.mjs'))
})
after(async () => {
  delete globalThis.__storefrontClient
  delete globalThis.__storefrontCalls
  await rm(dir, { recursive: true, force: true })
})
test('editorial saves whitelist fields and never send owner, approval or financial values', async () => {
  globalThis.__storefrontCalls = []
  await service.saveStorefrontProduct(
    { id: 'storefront', revision: '9007199254740993' },
    {
      id: 'product',
      name: 'Item',
      brand: 'Brand',
      description: 'Description',
      category: 'Fitness',
      storeUrl: 'https://example.invalid',
      priceCentavos: '999999999999',
      displayOrder: 2,
      owner_user_id: 'attacker',
      approved: true,
      expires_at: '2099',
    }
  )
  const args = globalThis.__storefrontCalls[0].args
  assert.equal(args.p_revision, '9007199254740993')
  assert.equal(args.p_data.priceCentavos, '999999999999')
  assert.equal(args.p_storefront_id, 'storefront')
  assert.doesNotMatch(JSON.stringify(args), /attacker|approved|expires_at|cash_balance/)
})
test('moderation uses content CAS and reasons; new storefront includes persistent intent key', async () => {
  globalThis.__storefrontCalls = []
  await service.createStorefront('Storefront', 'request')
  await service.setStorefrontEditorial({ id: 'storefront', revision: '5' }, 'submitted')
  assert.deepEqual(globalThis.__storefrontCalls, [
    { name: 'create_product_storefront', args: { p_name: 'Storefront', p_request_id: 'request' } },
    {
      name: 'set_storefront_editorial',
      args: { p_id: 'storefront', p_revision: '5', p_state: 'submitted', p_reason: '' },
    },
  ])
})
test('maintenance and legacy association preserve CAS, evidence and idempotency intent', async () => {
  globalThis.__storefrontCalls = []
  await service.configureStorefrontCleanup({
    enabled: true,
    graceSeconds: 7200,
    revision: '12',
    reason: 'Approved grace',
    confirm: true,
  })
  await service.associateLegacyProduct({
    product: { id: 'legacy', fingerprint: 'original' },
    target: { id: 'store', revision: '13', ownerId: 'verified' },
    evidence: 'Recorded provenance',
    requestId: 'intent',
    confirm: true,
  })
  assert.equal(globalThis.__storefrontCalls[0].args.p_revision, '12')
  const args = globalThis.__storefrontCalls[1].args
  assert.equal(args.p_fingerprint, 'original')
  assert.equal(args.p_verified_owner, 'verified')
  assert.equal(args.p_request, 'intent')
  assert.equal(args.p_revision, '13')
})

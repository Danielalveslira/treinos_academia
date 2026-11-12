import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir, service
const calls = []
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'supplier-gate-service-'))
  await build({
    entryPoints: [new URL('./supplierInfoGateService.js', import.meta.url).pathname],
    outfile: join(dir, 'service.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'supabase-fixture',
        setup(builder) {
          builder.onResolve({ filter: /\/supabase\/config$/ }, () => ({
            path: 'client',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export const supabase = globalThis.__supplierGateClient',
            loader: 'js',
          }))
        },
      },
    ],
  })
  globalThis.__supplierGateClient = {
    from(table) {
      calls.push(['from', table])
      if (table === 'cash_purchases')
        return {
          select(_columns, options) {
            assert.deepEqual(options, { head: true, count: 'exact' })
            return {
              eq(column, value) {
                assert.deepEqual([column, value], ['status', 'pending'])
                return Promise.resolve({
                  count: globalThis.__supplierPendingCount ?? 0,
                  error: null,
                })
              },
            }
          },
        }
      return {
        select() {
          return {
            eq() {
              return {
                single: async () => ({
                  data: { config: { supplierInfo: { configured: true } } },
                  error: null,
                }),
              }
            },
          }
        },
      }
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args])
      if (name === 'admin_get_evocash_pricing')
        return {
          data: { quotingEnabled: globalThis.__supplierQuotingEnabled ?? false },
          error: null,
        }
      if (name === 'admin_commercial_catalog')
        return { data: { items: globalThis.__supplierOfferings ?? [] }, error: null }
      if (name === 'admin_set_supplier_info_configured')
        return { data: { configured: true }, error: null }
      return {
        data: [
          {
            id: 'audit-id',
            action: 'supplier_info_gate_changed',
            reason: 'reason',
            metadata: { configured: true },
            admin_user_id: 'admin-id',
            created_at: new Date().toISOString(),
          },
        ],
        error: null,
      }
    },
    auth: { getUser: async () => ({ data: { user: { id: 'admin-id' } }, error: null }) },
  }
  service = await import(join(dir, 'service.mjs'))
})
after(async () => {
  delete globalThis.__supplierGateClient
  delete globalThis.__supplierQuotingEnabled
  delete globalThis.__supplierOfferings
  delete globalThis.__supplierPendingCount
  await rm(dir, { recursive: true, force: true })
})

test('safety check blocks when independent sales or EvoCash quoting is open', async () => {
  calls.length = 0
  assert.deepEqual(await service.getSupplierInfoActivationSafety(), { safe: true })
  assert.deepEqual(
    calls.map((call) => call[1]),
    ['admin_get_evocash_pricing', 'admin_commercial_catalog', 'cash_purchases']
  )
  globalThis.__supplierQuotingEnabled = true
  assert.deepEqual(await service.getSupplierInfoActivationSafety(), { safe: false })
  calls.length = 0
  await assert.rejects(service.confirmSupplierInfoConfigured('reason'), /FINANCIAL_GATES_OPEN/)
  assert.ok(!calls.some((call) => call[1] === 'admin_set_supplier_info_configured'))
  globalThis.__supplierQuotingEnabled = false
  globalThis.__supplierOfferings = [{ salesEnabled: true, integrationReady: true }]
  assert.deepEqual(await service.getSupplierInfoActivationSafety(), { safe: false })
  globalThis.__supplierOfferings = [{ salesEnabled: true, integrationReady: false }]
  assert.deepEqual(await service.getSupplierInfoActivationSafety(), { safe: false })
  globalThis.__supplierOfferings = []
  globalThis.__supplierPendingCount = 1
  assert.deepEqual(await service.getSupplierInfoActivationSafety(), { safe: false })
  globalThis.__supplierPendingCount = 0
})

test('confirmation writes only through the audited supplier RPC with true and a reason', async () => {
  calls.length = 0
  assert.equal(await service.getSupplierInfoConfigured(), true)
  assert.deepEqual(await service.confirmSupplierInfoConfigured('reason'), { configured: true })
  assert.deepEqual(calls, [
    ['from', 'economy_config'],
    ['rpc', 'admin_get_evocash_pricing', undefined],
    ['rpc', 'admin_commercial_catalog', undefined],
    ['from', 'cash_purchases'],
    [
      'rpc',
      'admin_set_supplier_info_configured',
      { p_configured: true, p_reason: 'reason', p_confirm: true },
    ],
  ])
})

test('audit verification matches the current admin, reason, action and time', async () => {
  calls.length = 0
  const event = await service.verifySupplierInfoAudit('reason', Date.now() - 1000)
  assert.equal(event.id, 'audit-id')
  assert.deepEqual(calls, [
    ['rpc', 'admin_list_audit_log', { p_target_user_id: null, p_limit: 100 }],
  ])
  await assert.rejects(
    service.verifySupplierInfoAudit('different reason', Date.now() - 1000),
    /AUDIT_READ_FAILED/
  )
})

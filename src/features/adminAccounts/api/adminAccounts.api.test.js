import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// O supabase (fake) só é carregado no primeiro uso (import dinâmico); a lista de chamadas
// precisa existir antes disso.
globalThis.__calls = []
let directory
let api
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'admin-accounts-api-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export * from './adminAccounts.api.js'`,
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
              export const supabase = {
                rpc: async (name, args) => {
                  globalThis.__calls.push({ kind: 'rpc', name, args })
                  return globalThis.__rpcResult
                },
                from: () => { throw new Error('a tela de contas não deve ler tabelas direto') },
                channel: () => { throw new Error('a tela de contas não usa realtime') },
              }
            `,
          }))
        },
      },
    ],
  })
  api = createRequire(import.meta.url)(outfile)
}
await bundle()
after(() => rm(directory, { recursive: true, force: true }))
beforeEach(() => {
  globalThis.__calls = []
  globalThis.__rpcResult = { data: { ok: true }, error: null }
})

test('snapshot = 1 RPC sem argumentos', async () => {
  assert.deepEqual(await api.fetchAccountsSnapshot(), { ok: true })
  assert.deepEqual(globalThis.__calls, [
    { kind: 'rpc', name: 'admin_accounts_snapshot', args: undefined },
  ])
})

test('leituras sob demanda: 1 RPC cada, com o uid certo', async () => {
  await api.fetchAccountCommunities('u1')
  await api.fetchAccountFinancial('u1')
  await api.fetchAuditLog({ targetUserId: 'u1', limit: 50 })
  await api.fetchAuditLog()
  assert.deepEqual(
    globalThis.__calls.map((c) => [c.name, c.args]),
    [
      ['admin_account_communities', { p_user_id: 'u1' }],
      ['admin_account_financial', { p_user_id: 'u1' }],
      ['admin_list_audit_log', { p_target_user_id: 'u1', p_limit: 50 }],
      ['admin_list_audit_log', { p_target_user_id: null, p_limit: 50 }],
    ]
  )
})

test('ações: 1 escrita por pedido, em lote numa única RPC', async () => {
  await api.setAccountsStatus(['a', 'b', 'c'], true, 'Spam recorrente')
  await api.requestAccountDeletion('a', 'Pedido do titular')
  assert.deepEqual(
    globalThis.__calls.map((c) => [c.name, c.args]),
    [
      [
        'admin_set_accounts_status',
        { p_user_ids: ['a', 'b', 'c'], p_disabled: true, p_reason: 'Spam recorrente' },
      ],
      ['admin_request_account_deletion', { p_user_id: 'a', p_reason: 'Pedido do titular' }],
    ]
  )
})

test('erro da RPC é propagado (a UI decide o que mostrar)', async () => {
  globalThis.__rpcResult = { data: null, error: { message: 'PERMISSION_DENIED' } }
  await assert.rejects(api.fetchAccountsSnapshot(), { message: 'PERMISSION_DENIED' })
})

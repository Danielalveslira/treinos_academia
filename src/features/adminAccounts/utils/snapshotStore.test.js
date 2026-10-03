import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSnapshotStore, isValidSnapshot } from './snapshotStore.js'
import {
  EMPTY_FILTERS,
  buildAccountsCsv,
  filterAccounts,
  paginate,
  sortAccounts,
} from './accounts.js'

function snapshotOf(accounts, generatedAt = '2026-10-10T12:00:00Z') {
  return {
    generated_at: generatedAt,
    metrics: {
      total_accounts: accounts.length,
      active_accounts: accounts.length,
      suspended_accounts: 0,
      new_accounts_7d: 0,
      pending_deletions: 0,
    },
    meta: {
      total: accounts.length,
      returned: accounts.length,
      truncated: false,
      max_snapshot_rows: 1000,
    },
    accounts,
  }
}
const row = (id) => ({
  id,
  username: id,
  email: `${id}@example.com`,
  role: 'user',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  last_sign_in_at: null,
  community_count: 0,
  financial_status: 'none',
  flags_count: 0,
  showcase_status: 'none',
  deletion_status: 'none',
  accepted_legal_version: null,
  restriction_action: null,
})

function spyFetcher(...responses) {
  const fetcher = async () => {
    fetcher.calls++
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next
  }
  fetcher.calls = 0
  return fetcher
}

test('abrir a tela não lê nada: só refresh() chama o banco', () => {
  const fetchSnapshot = spyFetcher()
  const store = createSnapshotStore({ fetchSnapshot })
  assert.equal(fetchSnapshot.calls, 0)
  assert.equal(store.getState().snapshot, null)
})

test('clicar Atualizar = 1 chamada; segundo clique durante a chamada não dispara outra', async () => {
  let release
  const gate = new Promise((resolve) => (release = resolve))
  let calls = 0
  const store = createSnapshotStore({
    fetchSnapshot: async () => {
      calls++
      await gate
      return snapshotOf([row('a')])
    },
  })
  const first = store.refresh()
  const second = store.refresh()
  assert.equal(store.getState().isRefreshing, true)
  assert.equal(first, second)
  release()
  assert.equal(await first, true)
  assert.equal(calls, 1)
  assert.equal(store.getState().isRefreshing, false)
  assert.equal(store.getState().syncedVersion, 1)
  await store.refresh()
  assert.equal(calls, 2) // novo clique depois de terminar é uma nova leitura
})

test('falha no refresh mantém o snapshot anterior e registra o erro', async () => {
  const fetchSnapshot = spyFetcher(snapshotOf([row('a'), row('b')]), new Error('rede caiu'))
  const store = createSnapshotStore({ fetchSnapshot })
  await store.refresh()
  const before = store.getState().snapshot
  assert.equal(await store.refresh(), false)
  assert.equal(store.getState().snapshot, before)
  assert.equal(store.getState().snapshot.accounts.length, 2)
  assert.equal(store.getState().error.message, 'rede caiu')
  assert.equal(store.getState().isRefreshing, false)
  assert.equal(store.getState().syncedVersion, 1)
})

test('resposta inválida/incompleta nunca substitui o snapshot válido', async () => {
  const fetchSnapshot = spyFetcher(snapshotOf([row('a')]), { accounts: [] }, null)
  const store = createSnapshotStore({ fetchSnapshot })
  await store.refresh()
  const before = store.getState().snapshot
  assert.equal(await store.refresh(), false)
  assert.equal(await store.refresh(), false)
  assert.equal(store.getState().snapshot, before)
  assert.equal(isValidSnapshot({ accounts: [] }), false)
})

test('um novo refresh bem-sucedido limpa o erro e a marca de alteração local', async () => {
  const fetchSnapshot = spyFetcher(
    snapshotOf([row('a')]),
    new Error('x'),
    snapshotOf([row('a'), row('b')], '2026-10-10T13:00:00Z')
  )
  const store = createSnapshotStore({ fetchSnapshot })
  await store.refresh()
  store.applyChanges(new Map([['a', { status: 'disabled' }]]))
  assert.ok(store.getState().localChangeAt)
  await store.refresh()
  assert.ok(store.getState().error)
  await store.refresh()
  assert.equal(store.getState().error, null)
  assert.equal(store.getState().localChangeAt, null)
  assert.equal(store.getState().snapshot.accounts.length, 2)
  assert.equal(store.getState().syncedVersion, 2)
})

test('busca, filtro, ordenação, paginação, CSV e ação local NÃO chamam o banco', async () => {
  const fetchSnapshot = spyFetcher(snapshotOf([row('a'), row('b'), row('c')]))
  const store = createSnapshotStore({ fetchSnapshot })
  await store.refresh()
  assert.equal(fetchSnapshot.calls, 1)

  const { accounts } = store.getState().snapshot
  const filtered = filterAccounts(accounts, { ...EMPTY_FILTERS, search: 'b', status: 'active' })
  const sorted = sortAccounts(filtered, { key: 'username', direction: 'asc' })
  paginate(sorted, 1, 25)
  buildAccountsCsv(sorted)
  store.applyChanges(new Map([['b', { status: 'disabled', disabled_reason: 'x' }]]))

  assert.equal(store.getState().snapshot.accounts[1].status, 'disabled')
  assert.equal(store.getState().snapshot.metrics.active_accounts, 2)
  assert.equal(fetchSnapshot.calls, 1)
})

test('assinantes são notificados nas mudanças e podem cancelar a assinatura', async () => {
  const store = createSnapshotStore({ fetchSnapshot: spyFetcher(snapshotOf([row('a')])) })
  let notifications = 0
  const unsubscribe = store.subscribe(() => notifications++)
  await store.refresh() // isRefreshing true + snapshot
  assert.equal(notifications, 2)
  unsubscribe()
  store.applyChanges(new Map([['a', { status: 'disabled' }]]))
  assert.equal(notifications, 2)
})

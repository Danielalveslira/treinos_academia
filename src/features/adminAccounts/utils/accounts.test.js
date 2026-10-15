import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  maskEmail,
  validateStatusResults,
  COLUMN_OPTIONS,
  CSV_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  EMPTY_FILTERS,
  applyAccountChanges,
  buildAccountsCsv,
  canDelete,
  canManageStatus,
  deletionRequestedChange,
  describeActionError,
  filterAccounts,
  hasActiveFilters,
  paginate,
  sortAccounts,
  statusChangeFor,
} from './accounts.js'

const NOW = new Date('2026-10-10T12:00:00Z').getTime()
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString()

function account(overrides = {}) {
  return {
    id: 'id-' + Math.random().toString(16).slice(2),
    username: 'ana',
    email: 'ana@example.com',
    role: 'user',
    status: 'active',
    created_at: hoursAgo(24 * 100),
    last_sign_in_at: hoursAgo(2),
    last_active_at: hoursAgo(2),
    community_count: 0,
    financial_status: 'none',
    flags_count: 0,
    showcase_status: 'none',
    deletion_status: 'none',
    accepted_legal_version: '1.4.0',
    restriction_action: null,
    ...overrides,
  }
}

const accounts = [
  account({
    id: 'a-1',
    username: 'claudia',
    email: 'claudia@gmail.com',
    community_count: 7,
    flags_count: 2,
  }),
  account({
    id: 'b-2',
    username: 'marcos',
    email: 'Marcos@Example.com',
    status: 'suspended',
    restriction_action: 'temporary_suspension',
    last_sign_in_at: hoursAgo(24 * 5),
    last_active_at: hoursAgo(24 * 5),
    community_count: 2,
  }),
  account({
    id: 'c-3',
    username: 'rafa',
    status: 'deleting',
    deletion_status: 'pending',
    financial_status: 'pending',
    last_sign_in_at: null,
    last_active_at: null,
  }),
  account({
    id: 'd-4',
    username: 'leticia',
    status: 'disabled',
    role: 'superadmin',
    created_at: hoursAgo(24 * 3),
    last_sign_in_at: hoursAgo(24 * 60),
    last_active_at: hoursAgo(24 * 60),
    financial_status: 'balance',
  }),
]

const ids = (list) => list.map((a) => a.id)
const f = (patch, tab = 'all') =>
  ids(filterAccounts(accounts, { ...EMPTY_FILTERS, ...patch }, tab, NOW))

test('busca por @usuário, e-mail (sem diferenciar caixa) e UID', () => {
  assert.deepEqual(f({ search: '@claud' }), ['a-1'])
  assert.deepEqual(f({ search: 'marcos@example' }), ['b-2'])
  assert.deepEqual(f({ search: 'D-4' }), ['d-4'])
  assert.deepEqual(f({ search: '   ' }).length, 4)
})

test('filtros de status, papel, financeiro, comunidade e último acesso', () => {
  assert.deepEqual(f({ status: 'suspended' }), ['b-2'])
  assert.deepEqual(f({ role: 'superadmin' }), ['d-4'])
  assert.deepEqual(f({ financial: 'balance' }), ['d-4'])
  assert.deepEqual(f({ community: 'many' }), ['a-1'])
  assert.deepEqual(f({ community: 'few' }), ['b-2'])
  assert.deepEqual(f({ community: 'none' }), ['c-3', 'd-4'])
  assert.deepEqual(f({ lastAccess: 'day' }), ['a-1'])
  assert.deepEqual(f({ lastAccess: 'week' }), ['a-1', 'b-2'])
  assert.deepEqual(f({ lastAccess: 'stale' }), ['d-4'])
  assert.deepEqual(f({ lastAccess: 'never' }), ['c-3'])
})

test('cartões de resumo e abas filtram sobre o mesmo snapshot', () => {
  assert.deepEqual(f({ card: 'active' }), ['a-1'])
  assert.deepEqual(f({ card: 'suspended' }), ['b-2'])
  assert.deepEqual(f({ card: 'deletions' }), ['c-3'])
  assert.deepEqual(f({ card: 'new7d' }), ['d-4'])
  assert.deepEqual(f({}, 'deletions'), ['c-3'])
  assert.deepEqual(f({}, 'risk'), ['a-1', 'b-2'])
})

test('filtros combinam (E) e hasActiveFilters detecta filtro ativo', () => {
  assert.deepEqual(f({ status: 'active', community: 'few' }), [])
  assert.equal(hasActiveFilters(EMPTY_FILTERS), false)
  assert.equal(hasActiveFilters({ ...EMPTY_FILTERS, card: 'active' }), true)
})

test('ordenação local, estável e sem mutar a entrada', () => {
  const before = ids(accounts)
  assert.deepEqual(ids(sortAccounts(accounts, { key: 'username', direction: 'asc' })), [
    'a-1',
    'd-4',
    'b-2',
    'c-3',
  ])
  assert.deepEqual(
    ids(sortAccounts(accounts, { key: 'community_count', direction: 'desc' })).slice(0, 2),
    ['a-1', 'b-2']
  )
  assert.deepEqual(
    ids(sortAccounts(accounts, { key: 'last_active_at', direction: 'desc' })).at(-1),
    'c-3'
  )
  assert.deepEqual(ids(accounts), before)
  assert.equal(sortAccounts(accounts, { key: 'inexistente' }), accounts)
})

test('paginação local limita a página ao intervalo válido', () => {
  const list = Array.from({ length: 30 }, (_, i) => i)
  assert.deepEqual(paginate(list, 2, 25), {
    rows: [25, 26, 27, 28, 29],
    page: 2,
    pageCount: 2,
    start: 25,
  })
  assert.equal(paginate(list, 99, 25).page, 2)
  assert.equal(paginate([], 1, 25).pageCount, 1)
})

test('regras de quem pode ser alterado/excluído espelham o banco', () => {
  assert.equal(canManageStatus(accounts[3]), false) // superadmin
  assert.equal(canManageStatus(accounts[2]), false) // em exclusão
  assert.equal(canManageStatus(accounts[0]), true)
  assert.equal(canDelete(accounts[3]), false)
  assert.equal(canDelete(accounts[2]), false)
})

test('applyAccountChanges atualiza a linha e ajusta as métricas por diferença', () => {
  const snapshot = {
    metrics: {
      total_accounts: 4,
      active_accounts: 1,
      suspended_accounts: 1,
      new_accounts_7d: 1,
      pending_deletions: 1,
    },
    accounts,
  }
  const disabled = applyAccountChanges(snapshot, new Map([['a-1', { status: 'disabled' }]]))
  assert.equal(disabled.accounts[0].status, 'disabled')
  assert.equal(disabled.metrics.active_accounts, 0)
  assert.equal(snapshot.accounts[0].status, 'active') // imutável
  assert.equal(snapshot.metrics.active_accounts, 1)

  const deleting = applyAccountChanges(snapshot, new Map([['a-1', deletionRequestedChange]]))
  assert.equal(deleting.metrics.active_accounts, 0)
  assert.equal(deleting.metrics.pending_deletions, 2)
  assert.equal(deleting.metrics.total_accounts, 4)
  assert.equal(applyAccountChanges(snapshot, new Map()), snapshot)
})

test('reativar conta com restrição vigente a deixa suspensa, não ativa', () => {
  assert.deepEqual(statusChangeFor(accounts[1], { account_status: 'active' }), {
    status: 'suspended',
    disabled_reason: null,
  })
  assert.deepEqual(statusChangeFor(accounts[0], { account_status: 'active' }), {
    status: 'active',
    disabled_reason: null,
  })
  assert.deepEqual(
    statusChangeFor(accounts[0], { account_status: 'disabled', disabled_reason: 'Spam' }),
    { status: 'disabled', disabled_reason: 'Spam' }
  )
})

test('CSV: BOM, cabeçalho, escape de aspas/vírgulas e proteção contra fórmula', () => {
  const csv = buildAccountsCsv([
    account({ id: 'x', username: 'ana', email: '=HYPERLINK("http://x")@evil.com' }),
    account({ id: 'y', username: null, email: 'a,b@example.com', accepted_legal_version: null }),
    account({ id: 'z', email: '+55@example.com' }),
  ])
  const lines = csv.slice(1).split('\r\n')
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.match(lines[0], /^ID,Usuário,E-mail,Papel,Status,/)
  assert.ok(lines[1].includes(`"'=HYPERLINK(""http://x"")@evil.com"`))
  assert.ok(lines[2].includes('"a,b@example.com"'))
  assert.ok(lines[3].includes(`'+55@example.com`))
  assert.ok(lines[1].includes('Membro,Ativa'))
  assert.equal(lines.length, 5) // cabeçalho + 3 + linha final vazia
})

test('mensagens de erro conhecidas viram texto amigável; o resto cai no fallback', () => {
  assert.equal(
    describeActionError({ message: 'ACCOUNT_DELETING' }, 'x'),
    'A conta está em exclusão e não pode ter o status alterado.'
  )
  assert.equal(
    describeActionError('CANNOT_DISABLE_ADMIN', 'x'),
    'Contas de administrador não podem ser desativadas.'
  )
  assert.equal(describeActionError({ message: 'boom' }, 'fallback'), 'fallback')
})

test('Último uso (last_active_at) e Último login (last_sign_in_at) são conceitos independentes', () => {
  const accounts = [
    // logou há 40 dias, mas usou o app há 1 hora (refresh token mantém a sessão)
    account({ id: 'uso-recente', last_sign_in_at: hoursAgo(24 * 40), last_active_at: hoursAgo(1) }),
    // logou agora e ainda não há registro de uso
    account({ id: 'sem-registro', last_sign_in_at: hoursAgo(1), last_active_at: null }),
  ]
  const f = (filters) => ids(filterAccounts(accounts, { ...EMPTY_FILTERS, ...filters }, 'all', NOW))
  assert.deepEqual(f({ lastAccess: 'day' }), ['uso-recente'])
  assert.deepEqual(f({ lastAccess: 'never' }), ['sem-registro'])
  assert.deepEqual(ids(sortAccounts(accounts, { key: 'last_active_at', direction: 'desc' })), [
    'uso-recente',
    'sem-registro',
  ])
  assert.deepEqual(ids(sortAccounts(accounts, { key: 'last_sign_in_at', direction: 'desc' })), [
    'sem-registro',
    'uso-recente',
  ])
})

test('CSV exporta Último uso e Último login em colunas separadas', () => {
  const headers = CSV_COLUMNS.map(([label]) => label)
  assert.ok(headers.includes('Último uso') && headers.includes('Último login'))
  assert.ok(!headers.includes('Último acesso'))
  const row = Object.fromEntries(
    CSV_COLUMNS.map(([label, get]) => [
      label,
      get(account({ last_sign_in_at: 'L', last_active_at: 'U' })),
    ])
  )
  assert.equal(row['Último uso'], 'U')
  assert.equal(row['Último login'], 'L')
})

test('"Último login" fica atrás do seletor de colunas por padrão', () => {
  assert.ok(DEFAULT_VISIBLE_COLUMNS.includes('last_active_at'))
  assert.ok(!DEFAULT_VISIBLE_COLUMNS.includes('last_sign_in_at'))
  assert.ok(COLUMN_OPTIONS.some((column) => column.key === 'last_sign_in_at'))
})

test('CSV protege espaços, controles e operadores Unicode sem perder escape', () => {
  for (const email of [' =1+2', '\n=1+2', '\t+SUM(A1)', '＝1+2', '＠SUM(A1)']) {
    const csv = buildAccountsCsv([account({ email })])
    assert.ok(csv.includes("'" + email), JSON.stringify(email))
  }
  assert.equal(maskEmail('private@example.invalid'), 'p•••@example.invalid')
  assert.equal(maskEmail(null), '—')
})

test('resposta parcial malformada, repetida ou com alvo externo é rejeitada', () => {
  for (const results of [
    [],
    null,
    [{ id: 'x', ok: true, account_status: 'active' }],
    [{ id: 'a', ok: true }],
    [
      { id: 'a', ok: true, account_status: 'active' },
      { id: 'a', ok: false },
    ],
  ])
    assert.throws(() => validateStatusResults(results, ['a']), /INVALID_RESPONSE/)
})

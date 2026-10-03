// Regras puras da tela de Contas: tudo o que acontece DEPOIS do snapshot (busca, filtros,
// ordenação, paginação, seleção, CSV, atualização local após ações) roda em memória e
// nunca fala com o banco.

export const STATUS_LABELS = {
  active: 'Ativa',
  suspended: 'Suspensa',
  deleting: 'Pendente de exclusão',
  disabled: 'Desativada',
}

// Variantes do Label do Primer: verde / vermelho / amarelo / cinza.
export const STATUS_VARIANTS = {
  active: 'success',
  suspended: 'danger',
  deleting: 'attention',
  disabled: 'secondary',
}

export const ROLE_LABELS = { user: 'Membro', superadmin: 'Superadmin' }

export const FINANCIAL_LABELS = {
  none: 'Sem saldo',
  balance: 'Com saldo',
  pending: 'Pendente',
}

export const SHOWCASE_LABELS = {
  none: 'Sem vitrine',
  draft: 'Rascunho',
  published: 'Ativo',
  archived: 'Arquivada',
  suspended: 'Suspensa',
  deleting: 'Em exclusão',
}

// deletion_jobs.state de contas (mesmos rótulos do painel "Exclusão de contas").
export const DELETION_LABELS = {
  none: 'Não solicitada',
  pending: 'Em andamento',
  blocked_financial_review: 'Bloqueada por revisão financeira',
  auth_cleanup: 'Finalizando (remoção do acesso)',
}

export const AUDIT_ACTION_LABELS = {
  account_disabled: 'Conta desativada',
  account_reactivated: 'Conta reativada',
  account_deletion_requested: 'Exclusão solicitada',
}

export const PURCHASE_STATUS_LABELS = {
  pending: 'Pendente',
  credited: 'Creditada',
  cancelled: 'Cancelada',
  held_in_case: 'Retida em caso financeiro',
}

export const RESTRICTION_LABELS = {
  temporary_suspension: 'Suspensão temporária',
  system_ban: 'Banimento do sistema',
}

export const TABS = [
  { key: 'all', label: 'Todas as contas' },
  { key: 'deletions', label: 'Exclusões pendentes' },
  { key: 'risk', label: 'Moderação / risco' },
  { key: 'logs', label: 'Logs administrativos' },
]

export const PAGE_SIZES = [8, 25, 50, 100]

export const COLUMN_OPTIONS = [
  { key: 'role', label: 'Papel' },
  { key: 'last_sign_in_at', label: 'Último acesso' },
  { key: 'created_at', label: 'Criado em' },
  { key: 'community_count', label: 'Comunidades' },
  { key: 'financial_status', label: 'Financeiro' },
  { key: 'flags_count', label: 'Flags' },
]

export const LAST_ACCESS_OPTIONS = [
  { key: 'day', label: 'Últimas 24 horas' },
  { key: 'week', label: 'Últimos 7 dias' },
  { key: 'month', label: 'Últimos 30 dias' },
  { key: 'stale', label: 'Há mais de 30 dias' },
  { key: 'never', label: 'Nunca acessou' },
]

export const COMMUNITY_OPTIONS = [
  { key: 'none', label: 'Sem comunidades' },
  { key: 'few', label: '1 a 2 comunidades' },
  { key: 'many', label: '3 ou mais' },
]

export const EMPTY_FILTERS = {
  search: '',
  status: '',
  role: '',
  lastAccess: '',
  community: '',
  financial: '',
  card: '', // '' | 'active' | 'suspended' | 'new7d' | 'deletions' -- cartões de resumo como filtro
}

const DAY = 24 * 60 * 60 * 1000

export function canManageStatus(account) {
  return account.role !== 'superadmin' && account.status !== 'deleting'
}

export function canDelete(account) {
  return account.role !== 'superadmin' && account.status !== 'deleting'
}

export function hasActiveFilters(filters) {
  return Object.keys(EMPTY_FILTERS).some((key) => filters[key] !== EMPTY_FILTERS[key])
}

function matchesSearch(account, term) {
  const query = term.trim().toLowerCase()
  if (!query) return true
  const bare = query.replace(/^@/, '')
  return (
    (account.username || '').toLowerCase().includes(bare) ||
    (account.email || '').toLowerCase().includes(query) ||
    account.id.toLowerCase().includes(query)
  )
}

function matchesLastAccess(account, key, now) {
  if (!key) return true
  if (key === 'never') return !account.last_sign_in_at
  if (!account.last_sign_in_at) return false
  const age = now - new Date(account.last_sign_in_at).getTime()
  if (key === 'day') return age <= DAY
  if (key === 'week') return age <= 7 * DAY
  if (key === 'month') return age <= 30 * DAY
  return age > 30 * DAY
}

function matchesCommunity(account, key) {
  if (!key) return true
  if (key === 'none') return account.community_count === 0
  if (key === 'few') return account.community_count >= 1 && account.community_count <= 2
  return account.community_count >= 3
}

function matchesCard(account, key, now) {
  if (!key) return true
  if (key === 'active') return account.status === 'active'
  if (key === 'suspended') return account.status === 'suspended'
  if (key === 'new7d') return now - new Date(account.created_at).getTime() <= 7 * DAY
  if (key === 'deletions') return account.deletion_status !== 'none'
  return true
}

function matchesTab(account, tab) {
  if (tab === 'deletions') return account.deletion_status !== 'none'
  if (tab === 'risk') return account.flags_count > 0 || account.status === 'suspended'
  return true
}

export function filterAccounts(accounts, filters, tab = 'all', now = Date.now()) {
  return accounts.filter(
    (account) =>
      matchesTab(account, tab) &&
      matchesSearch(account, filters.search) &&
      (!filters.status || account.status === filters.status) &&
      (!filters.role || account.role === filters.role) &&
      matchesLastAccess(account, filters.lastAccess, now) &&
      matchesCommunity(account, filters.community) &&
      (!filters.financial || account.financial_status === filters.financial) &&
      matchesCard(account, filters.card, now)
  )
}

export const SORT_ACCESSORS = {
  username: (a) => (a.username || a.email || a.id).toLowerCase(),
  role: (a) => a.role,
  status: (a) => a.status,
  last_sign_in_at: (a) => (a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : -Infinity),
  created_at: (a) => new Date(a.created_at).getTime(),
  community_count: (a) => a.community_count,
  flags_count: (a) => a.flags_count,
}

export function sortAccounts(accounts, sort) {
  const accessor = SORT_ACCESSORS[sort?.key]
  if (!accessor) return accounts
  const direction = sort.direction === 'asc' ? 1 : -1
  return [...accounts].sort((a, b) => {
    const left = accessor(a)
    const right = accessor(b)
    if (left < right) return -direction
    if (left > right) return direction
    return a.id < b.id ? -1 : 1
  })
}

export function paginate(items, page, pageSize) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  const start = (current - 1) * pageSize
  return { rows: items.slice(start, start + pageSize), page: current, pageCount, start }
}

// --- Atualização local após ação administrativa (sem refetch) ---------------------------

function metricDelta(before, after) {
  return {
    active_accounts: Number(after.status === 'active') - Number(before.status === 'active'),
    suspended_accounts:
      Number(after.status === 'suspended') - Number(before.status === 'suspended'),
    pending_deletions:
      Number(after.deletion_status !== 'none') - Number(before.deletion_status !== 'none'),
  }
}

// changes: Map<userId, Partial<account>> -- aplica na lista e ajusta as métricas por diferença
// (as métricas cobrem a base inteira, então não dá para recalculá-las só pela lista).
export function applyAccountChanges(snapshot, changes) {
  if (!snapshot || changes.size === 0) return snapshot
  const metrics = { ...snapshot.metrics }
  const accounts = snapshot.accounts.map((account) => {
    const change = changes.get(account.id)
    if (!change) return account
    const next = { ...account, ...change }
    const delta = metricDelta(account, next)
    for (const key of Object.keys(delta)) metrics[key] += delta[key]
    return next
  })
  return { ...snapshot, accounts, metrics }
}

// Resultado de set_account_status -> campos da linha. Reativar uma conta que ainda tem
// restrição de moderação vigente a deixa "Suspensa", nunca "Ativa".
export function statusChangeFor(account, result) {
  if (result.account_status === 'disabled') {
    return { status: 'disabled', disabled_reason: result.disabled_reason || null }
  }
  return { status: account.restriction_action ? 'suspended' : 'active', disabled_reason: null }
}

export const deletionRequestedChange = { status: 'deleting', deletion_status: 'pending' }

// --- CSV (dados já em memória) ---------------------------------------------------------

export const CSV_COLUMNS = [
  ['ID', (a) => a.id],
  ['Usuário', (a) => (a.username ? `@${a.username}` : '')],
  ['E-mail', (a) => a.email || ''],
  ['Papel', (a) => ROLE_LABELS[a.role] || a.role],
  ['Status', (a) => STATUS_LABELS[a.status] || a.status],
  ['Último acesso', (a) => a.last_sign_in_at || ''],
  ['Criado em', (a) => a.created_at],
  ['Comunidades', (a) => a.community_count],
  ['Financeiro', (a) => FINANCIAL_LABELS[a.financial_status] || a.financial_status],
  ['Flags', (a) => a.flags_count],
  ['Vitrine', (a) => SHOWCASE_LABELS[a.showcase_status] || a.showcase_status],
  ['Exclusão', (a) => DELETION_LABELS[a.deletion_status] || a.deletion_status],
  ['Versão legal aceita', (a) => a.accepted_legal_version || ''],
]

// Planilhas interpretam células iniciadas por = + - @ (e tab/CR) como fórmula; e-mail é
// dado do usuário, então essas células recebem um apóstrofo à frente.
function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// BOM para o Excel abrir o UTF-8 com acentos corretos.
const CSV_BOM = String.fromCharCode(0xfeff)

export function buildAccountsCsv(accounts) {
  const lines = [CSV_COLUMNS.map(([header]) => csvCell(header)).join(',')]
  for (const account of accounts) {
    lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(account))).join(','))
  }
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`
}

export function csvFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `contas-evolutus-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.csv`
}

// --- Mensagens de erro -------------------------------------------------------------------

export const KNOWN_ERRORS = {
  PERMISSION_DENIED: 'Você não tem permissão para esta ação.',
  NOT_FOUND: 'Conta não encontrada.',
  CANNOT_DISABLE_ADMIN: 'Contas de administrador não podem ser desativadas.',
  CANNOT_DELETE_ADMIN: 'Contas de administrador não podem ser excluídas.',
  CANNOT_DELETE_SELF: 'Você não pode excluir a própria conta.',
  ACCOUNT_DELETING: 'A conta está em exclusão e não pode ter o status alterado.',
  INVALID_REASON: 'Informe um motivo de 5 a 500 caracteres.',
  INVALID_ARGUMENT: 'Seleção inválida (máximo de 100 contas por ação).',
  OWNS_ACTIVE_COMMUNITY:
    'A conta é dona de uma comunidade ativa. Transfira ou encerre a comunidade antes.',
}

export function describeActionError(error, fallback) {
  const key = typeof error === 'string' ? error : error?.message
  return KNOWN_ERRORS[key] || fallback
}

import { validateStatusResults } from '../utils/accounts.js'
// Tela admin "Contas". Todas as leituras passam por RPCs security definer protegidas por
// is_superadmin() (ver migration 20261010000001): nada aqui usa service_role nem lê auth.users.
//
// Orçamento de chamadas: fetchAccountsSnapshot é a ÚNICA leitura da tela principal (1 por
// clique em Atualizar). As demais leituras são sob demanda (abas do painel / logs).

async function getSupabase() {
  return (await import('../../../supabase/config')).supabase
}

async function call(name, args) {
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

export function fetchAccountsSnapshot() {
  return call('admin_accounts_snapshot')
}

function checkedList(data, limit) {
  if (
    !Array.isArray(data) ||
    data.length > limit ||
    !data.every((row) => row && typeof row.id === 'string')
  )
    throw new Error('INVALID_RESPONSE')
  return data
}

export async function fetchAccountCommunities(userId) {
  const data = await call('admin_account_communities', { p_user_id: userId })
  checkedList(data, 100)
  if (!data.every((row) => typeof row.name === 'string')) throw new Error('INVALID_RESPONSE')
  return data
}

export async function fetchAccountFinancial(userId) {
  const data = await call('admin_account_financial', { p_user_id: userId })
  if (!data || !Number.isFinite(data.coin_balance) || !Number.isFinite(data.cash_balance))
    throw new Error('INVALID_RESPONSE')
  checkedList(data.recent_purchases, 5)
  return data
}

export async function fetchAuditLog({ targetUserId = null, limit = 50 } = {}) {
  const data = await call('admin_list_audit_log', {
    p_target_user_id: targetUserId,
    p_limit: limit,
  })
  checkedList(data, 100)
  if (
    !data.every(
      (row) =>
        typeof row.action === 'string' && (row.reason == null || typeof row.reason === 'string')
    )
  )
    throw new Error('INVALID_RESPONSE')
  return data
}

// 1 escrita para 1..100 contas; devolve [{ id, ok, account_status?, disabled_reason?, error? }].
export async function setAccountsStatus(userIds, disabled, reason = '') {
  if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > 100)
    throw new Error('INVALID_ARGUMENT')
  const results = await call('admin_set_accounts_status', {
    p_user_ids: userIds,
    p_disabled: disabled,
    p_reason: reason,
  })
  return validateStatusResults(results, userIds)
}

export async function requestAccountDeletion(userId, reason) {
  await call('admin_request_account_deletion', { p_user_id: userId, p_reason: reason })
}

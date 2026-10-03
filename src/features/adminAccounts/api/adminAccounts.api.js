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

export function fetchAccountCommunities(userId) {
  return call('admin_account_communities', { p_user_id: userId })
}

export function fetchAccountFinancial(userId) {
  return call('admin_account_financial', { p_user_id: userId })
}

export function fetchAuditLog({ targetUserId = null, limit = 50 } = {}) {
  return call('admin_list_audit_log', { p_target_user_id: targetUserId, p_limit: limit })
}

// 1 escrita para 1..100 contas; devolve [{ id, ok, account_status?, disabled_reason?, error? }].
export function setAccountsStatus(userIds, disabled, reason = '') {
  return call('admin_set_accounts_status', {
    p_user_ids: userIds,
    p_disabled: disabled,
    p_reason: reason,
  })
}

export async function requestAccountDeletion(userId, reason) {
  await call('admin_request_account_deletion', { p_user_id: userId, p_reason: reason })
}

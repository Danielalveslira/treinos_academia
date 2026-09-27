import { supabase } from '../supabase/config'

function toAccountView(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    accountStatus: row.account_status,
    disabledReason: row.disabled_reason,
    createdAt: row.created_at,
  }
}

export async function setAccountStatus(userId, disabled, reason = '') {
  const { data, error } = await supabase
    .rpc('set_account_status', { p_user_id: userId, p_disabled: disabled, p_reason: reason })
    .single()
  if (error) throw error
  return { account: toAccountView(data) }
}

export async function deleteAccountPermanently(userId, confirmation) {
  if (confirmation !== 'EXCLUIR') throw new Error('Digite EXCLUIR para confirmar.')
  const { error } = await supabase.rpc('queue_deletion', { p_kind: 'account', p_target_id: userId })
  if (error) throw error
  return {}
}

// Join direto com auth.users em vez de Cloud Function: ao contrário do Firebase
// (Auth e Firestore são sistemas separados), aqui os dois vivem no mesmo Postgres.
export async function listAccountsPage({ search = '', cursor = null, pageSize = 50 } = {}) {
  const { data, error } = await supabase.rpc('admin_list_accounts', {
    p_search: search,
    p_cursor: cursor,
    p_page_size: pageSize,
  })
  if (error) throw error
  return {
    accounts: data.map(toAccountView),
    nextCursor: data.length === pageSize ? data.at(-1).id : null,
  }
}

// list_deletion_jobs (RPC) só retorna jobs 'pending' — jobs
// 'blocked_financial_review' ficam fora, mesmo comportamento do main (o painel de
// revisão financeira dedicado ainda não foi portado, ver docs/prompts).
export async function listDeletionJobs() {
  const { data, error } = await supabase.rpc('list_deletion_jobs')
  if (error) throw error
  return data.map((row) => ({
      id: `${row.kind}_${row.target_id}`,
      kind: row.kind,
      targetId: row.target_id,
      requestedBy: row.requested_by,
      state: row.state,
      stage: row.stage,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
}

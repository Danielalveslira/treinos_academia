import { supabase } from '../supabase/config'

// deletion_jobs não tem policy nenhuma (server_only) -- superadmin incluso -- então o
// painel "Exclusão de contas" só existe através destas RPCs security definer (ver
// migrations 20260929000001_admin_account_deletion_review.sql e
// 20261004000001_account_deletion_financial_case.sql). Toda decisão financeira (separar
// caso, cancelar, revalidar) é tomada no banco -- o cliente só pede e mostra o resultado.

// scope 'open' = pending + blocked_financial_review; 'closed' = complete + cancelled
// (últimos 60 dias).
export async function listAccountDeletions(scope = 'open') {
  const { data, error } = await supabase.rpc('admin_list_account_deletions', { p_scope: scope })
  if (error) throw error
  return data
}

// Ação segura: nunca altera saldo/ledger, só reavalia o bloqueio com os valores atuais
// e, se já estiver claro, retoma o job -- ver review_blocked_account_deletion.
export async function reviewBlockedAccountDeletion(jobId, note) {
  const { data, error } = await supabase.rpc('review_blocked_account_deletion', {
    p_job_id: jobId,
    p_note: note,
  })
  if (error) throw error
  return data
}

// Cria (ou devolve, se já existir) o caso financeiro separado e libera o job para o
// worker concluir a exclusão. NUNCA exclui nada daqui e NUNCA mexe em saldo/ledger.
export async function separateFinancialCaseAndResumeDeletion(jobId, note) {
  const { data, error } = await supabase.rpc('separate_financial_case_and_resume_deletion', {
    p_job_id: jobId,
    p_note: note,
  })
  if (error) throw error
  return data
}

// Só enquanto reversível (job pending/blocked) -- depois da exclusão concluída o banco recusa.
export async function cancelAccountDeletion(jobId, note) {
  const { data, error } = await supabase.rpc('cancel_account_deletion', {
    p_job_id: jobId,
    p_note: note,
  })
  if (error) throw error
  return data
}

export async function getDeletionFinancialHistory(jobId) {
  const { data, error } = await supabase.rpc('admin_get_deletion_financial_history', {
    p_job_id: jobId,
  })
  if (error) throw error
  return data
}

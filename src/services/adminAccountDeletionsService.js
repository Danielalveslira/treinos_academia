import { supabase } from '../supabase/config'

// deletion_jobs não tem policy nenhuma (server_only) -- superadmin incluso -- então o
// painel "Exclusão de contas" só existe através destas duas RPCs security definer (ver
// migration 20260929000001_admin_account_deletion_review.sql).
export async function listBlockedAccountDeletions() {
  const { data, error } = await supabase.rpc('list_blocked_account_deletions')
  if (error) throw error
  return data
}

// Ação segura: nunca altera saldo/ledger, só reavalia o bloqueio com os valores atuais
// e, se já estiver claro, retoma o job -- ver review_blocked_account_deletion.
export async function reviewBlockedAccountDeletion(jobId, note) {
  const { data, error } = await supabase.rpc('review_blocked_account_deletion', {
    p_job_id: jobId,
    p_note: note || null,
  })
  if (error) throw error
  return data
}

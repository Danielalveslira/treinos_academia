import { supabase } from '../supabase/config'

// Único jeito seguro do cliente saber o próprio estado de exclusão — deletion_jobs não
// tem policy de leitura nenhuma pro dono (só service_role/RPCs security definer), então
// um erro de RLS na leitura do próprio perfil, sozinho, não diz se a exclusão está em
// processamento, bloqueada por revisão financeira ou se a conta já foi excluída de vez
// (ver AuthContext.jsx, handlePossibleGhostSession). Devolve só { state }, nunca
// block_reason, saldo ou qualquer outro dado financeiro.
export async function getMyDeletionStatus() {
  const { data, error } = await supabase.rpc('get_my_deletion_status')
  if (error) throw error
  return { state: data }
}

// Versão rica de getMyDeletionStatus para a tela "Exclusão em análise": estado, protocolo
// da solicitação e se a pendência financeira foi separada (com o protocolo do caso, que é
// o que o usuário cita no atendimento). Continua sem NENHUM dado financeiro privado --
// nunca saldo, valores, motivo do bloqueio. Devolve null quando não há exclusão em
// andamento (nunca pedida, já concluída ou cancelada).
export async function getMyDeletionReview() {
  const { data, error } = await supabase.rpc('get_my_deletion_review')
  if (error) throw error
  return data || null
}

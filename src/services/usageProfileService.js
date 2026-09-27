import { supabase } from '../supabase/config'

// Sempre pela RPC, nunca escrita direta na tabela — tanto a primeira declaração
// (cadastro, ou preenchimento contextual de conta legada) quanto uma troca posterior
// passam pelo mesmo caminho (checagem de vitrine ativa ainda pendente de portar, ver
// migration users_new_fields.sql).
export async function setUsageProfile(usageProfile) {
  const { error } = await supabase.rpc('set_usage_profile', { p_usage_profile: usageProfile })
  if (error) throw error
  return { usageProfile }
}

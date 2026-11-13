import { supabase } from '../supabase/config'

// Única RPC usada pelo painel Início para números reais de pendência (não a amostra
// truncada que cada listagem por domínio já usa para seu próprio "carregar mais").
export async function getCommercialPendingCounts() {
  const { data, error } = await supabase.rpc('admin_commercial_pending_counts')
  if (error) throw error
  return data
}

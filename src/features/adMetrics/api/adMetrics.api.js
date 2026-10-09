// Leitura do dashboard de métricas de patrocinados: UMA RPC administrativa (somente superadmin, verificado no banco).
// Nenhum marcador, evento individual ou user_id passa por aqui. O módulo do Supabase só é carregado na primeira chamada.
import { buildRpcArgs } from '../utils/metrics'

export async function fetchAdMetricsDashboard(filters) {
  const { supabase } = await import('../../../supabase/config')
  const { data, error } = await supabase.rpc(
    'get_sponsored_ad_metrics_dashboard',
    buildRpcArgs(filters)
  )
  if (error) throw error
  return data
}

import { supabase } from '../supabase/config'

// Fase 5 (privilégios com EvoCash) -- requisitos e custo vêm sempre de
// economy_config, nunca hardcoded aqui (mesmo padrão de
// cashPurchaseService.getCashPurchaseSettings): a RPC revalida tudo de novo antes de
// cobrar, isto é só para a UI mostrar o que falta.
export async function getCreateCommunityPrivilege() {
  const { data, error } = await supabase.from('economy_config').select('config').eq('id', true).maybeSingle()
  if (error) throw error
  return data?.config?.privileges?.createCommunity || null
}

// requestId gerado uma vez por tentativa e reenviado em qualquer retry -- mesma
// idempotência de requestCashPurchase (ver migration privilege_create_community.sql:
// (user_id, request_id) só grava depois que tudo dá certo).
export async function createCommunityWithCash({ name, description, iconName, requestId }) {
  const { data, error } = await supabase.rpc('create_community_with_cash', {
    p_name: name,
    p_description: description,
    p_icon_name: iconName,
    p_request_id: requestId,
  })
  if (error) throw error
  return { communityId: data.id, replay: data.replay }
}

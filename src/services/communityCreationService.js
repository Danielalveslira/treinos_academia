import { supabase } from '../supabase/config'

// Criação de comunidades. Toda decisão (elegibilidade, preço, saldo, tier/retenção, limite)
// é do banco -- estas funções só chamam as RPCs e devolvem o que o servidor respondeu. A
// tela usa o retorno para MOSTRAR; create_community recalcula tudo de novo antes de cobrar.

// Progresso de elegibilidade (público): dias de conta, dias ativos, situação, limite, saldo.
export async function getCommunityCreationEligibility() {
  const { data, error } = await supabase.rpc('get_my_community_creation_eligibility')
  if (error) throw error
  return data
}

// Catálogo (tier, retenção, preço por forma de pagamento) -- sempre do servidor.
export async function listCommunityCreationProducts() {
  const { data, error } = await supabase.rpc('list_community_creation_products')
  if (error) throw error
  return Array.isArray(data) ? data : []
}

// idempotencyKey é gerada uma vez por tentativa e reenviada em qualquer retry: a mesma
// solicitação repetida devolve a comunidade original sem cobrar de novo.
export async function createCommunity({
  name,
  description,
  iconName,
  tier,
  paymentMethod,
  idempotencyKey,
}) {
  const { data, error } = await supabase.rpc('create_community', {
    p_name: name,
    p_description: description,
    p_icon_name: iconName,
    p_tier: tier,
    p_payment_method: paymentMethod,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
  return { communityId: data.id, replay: data.replay, tier: data.tier }
}

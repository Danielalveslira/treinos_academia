import { supabase } from '../supabase/config'

// Criação de comunidades. Toda decisão (elegibilidade, preço, saldo, tier/retenção, limite,
// benefício gratuito) é do banco -- estas funções só chamam as RPCs e devolvem o que o
// servidor respondeu. A tela usa o retorno para MOSTRAR; create_community/create_free_community
// recalculam tudo de novo antes de criar/cobrar.

// Progresso de elegibilidade (público): dias de conta, dias ativos, situação, limite, saldo.
export async function getCommunityCreationEligibility() {
  const { data, error } = await supabase.rpc('get_my_community_creation_eligibility')
  if (error) throw error
  return data
}

// Catálogo (tier, retenção, preço por forma de pagamento, free) -- sempre do servidor.
export async function listCommunityCreationProducts() {
  const { data, error } = await supabase.rpc('list_community_creation_products')
  if (error) throw error
  return Array.isArray(data) ? data : []
}

// idempotencyKey é gerada uma vez por tentativa e reenviada em qualquer retry: a mesma
// solicitação repetida devolve a comunidade original sem cobrar de novo. postAccess entra no
// hash de idempotência no servidor -- ver create_community (20261214000006).
export async function createCommunity({
  name,
  description,
  iconName,
  tier,
  paymentMethod,
  postAccess,
  idempotencyKey,
}) {
  const { data, error } = await supabase.rpc('create_community', {
    p_name: name,
    p_description: description,
    p_icon_name: iconName,
    p_tier: tier,
    p_payment_method: paymentMethod,
    p_idempotency_key: idempotencyKey,
    p_post_access: postAccess,
  })
  if (error) throw error
  return { communityId: data.id, replay: data.replay, tier: data.tier }
}

// Primeira comunidade gratuita (tier "starter"). Sem preço/forma de pagamento -- RPC própria
// (create_free_community, 20261214000005), nunca cobra nada.
export async function createFreeCommunity({ name, description, iconName, postAccess, idempotencyKey }) {
  const { data, error } = await supabase.rpc('create_free_community', {
    p_name: name,
    p_description: description,
    p_icon_name: iconName,
    p_post_access: postAccess,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
  return { communityId: data.id, replay: data.replay, tier: data.tier }
}

// Cotação read-only do upgrade (quote_community_tier_upgrade, 20261214000007): mostra o valor
// devido ANTES de cobrar -- amountDue deve ser reenviado como expectedAmount em
// upgradeCommunityTier; se o preço mudou entre a cotação e a confirmação, o servidor rejeita
// com PRICE_CHANGED em vez de cobrar um valor diferente do aprovado.
export async function quoteCommunityTierUpgrade({ communityId, tier, paymentMethod }) {
  const { data, error } = await supabase.rpc('quote_community_tier_upgrade', {
    p_community_id: communityId,
    p_tier: tier,
    p_payment_method: paymentMethod,
  })
  if (error) throw error
  return data
}

export async function upgradeCommunityTier({
  communityId,
  tier,
  paymentMethod,
  idempotencyKey,
  expectedAmount,
}) {
  const { data, error } = await supabase.rpc('upgrade_community_tier', {
    p_community_id: communityId,
    p_tier: tier,
    p_payment_method: paymentMethod,
    p_idempotency_key: idempotencyKey,
    p_expected_amount: expectedAmount,
  })
  if (error) throw error
  return { communityId: data.id, replay: data.replay, tier: data.tier, amountCharged: data.amountCharged }
}

// Alterar "quem pode publicar" depois da criação (dono ou superadmin) -- set_community_post_access,
// 20261214000006.
export async function setCommunityPostAccess({ communityId, postAccess }) {
  const { data, error } = await supabase.rpc('set_community_post_access', {
    p_community_id: communityId,
    p_post_access: postAccess,
  })
  if (error) throw error
  return data
}

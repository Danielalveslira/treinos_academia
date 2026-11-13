import { supabase } from '../supabase/config'
import { mapStatusRow } from './statusesService'
import { mapCommunityRow } from './communitiesService'
import { adAuthorizationDeadline } from '../utils/adAuthorization'

const MY_PROMOTIONS_LIMIT = 50
const ADMIN_LIST_LIMIT = 200

export async function authorizePromotionSources(communityIds = [], statusIds = []) {
  const started = performance.now()
  const { data, error } = await supabase.rpc('get_advertising_promotion_authorizations', {
    p_community_ids: communityIds,
    p_status_ids: statusIds,
  })
  if (error) throw error
  return {
    communityIds: data.community_ids,
    statusIds: data.status_ids,
    deadline: adAuthorizationDeadline(data.expires_at, data.server_time, started),
  }
}

function mapPromotionRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    billingMode: row.billing_mode,
    resourceId: row.commercial_resource_id,
    targetType: row.target_type,
    targetId: row.target_id,
    communityId: row.community_id,
    packageId: row.package_id,
    cashAmount: row.cash_amount,
    durationDays: row.duration_days,
    status: row.status,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
    clickCount: row.click_count,
    createdAt: row.created_at,
  }
}

export async function cancelPromotion({ promotionId, reason }) {
  const { data, error } = await supabase.rpc('cancel_promotion', {
    p_promotion_id: promotionId,
    p_reason: reason || null,
  })
  if (error) throw error
  return data
}

// "Fogo e esquece" da perspectiva da UI -- uma falha aqui nunca deveria impedir a
// navegação/exibição do conteúdo (métrica informativa, nunca base de cobrança).
export async function recordPromotionClick({ targetType, targetId, promotionId }) {
  const { data, error } = await supabase.rpc('record_promotion_event', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_promotion_id: promotionId,
    p_type: 'click',
  })
  if (error) throw error
  return data
}

// Server time and publication RLS authorize the bounded, equivalent rotation.
export async function listFeaturedStatusesForCommunity(communityId) {
  const { data, error } = await supabase.rpc('list_commercial_featured_statuses', {
    p_community: communityId,
  })
  if (error) throw error
  return data.map(mapStatusRow)
}

export async function listFeaturedCommunities() {
  const { data, error } = await supabase.rpc('list_commercial_featured_communities')
  if (error) throw error
  return data.map(mapCommunityRow)
}

// "Minhas promoções" -- histórico do próprio usuário (ativa, cancelada ou com o alvo
// removido). Sem filtro de status: "expirada" é só um rótulo calculado na exibição
// (ver utils/promotionStatus.js), nunca um valor gravado.
export async function listMyPromotions(uid) {
  const { data, error } = await supabase
    .from('promotions')
    .select('*')
    .eq('owner_id', uid)
    .order('created_at', { ascending: false })
    .limit(MY_PROMOTIONS_LIMIT)
  if (error) throw error
  return data.map(mapPromotionRow)
}

// Só superadmin consegue de fato ler isto (RLS) -- usado pelo painel admin de
// moderação de promoções, NUNCA o painel de sponsoredAds (sistemas separados).
export async function listAllPromotionsForAdmin() {
  const { data, error } = await supabase
    .from('promotions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(ADMIN_LIST_LIMIT)
  if (error) throw error
  return data.map(mapPromotionRow)
}

export async function prepareCommercialPromotion(targetType, targetId) {
  const { data, error } = await supabase.rpc('prepare_commercial_promotion', {
    p_type: targetType,
    p_id: targetId,
  })
  if (error) throw error
  return data
}

export async function getDirectPostBoostOffer(statusId) {
  const { data, error } = await supabase.rpc('get_direct_post_boost_offer', {
    p_status_id: statusId,
  })
  if (error) throw error
  return data
}

export async function prepareDirectPostBoost(statusId) {
  const { data, error } = await supabase.rpc('prepare_direct_post_boost', {
    p_status_id: statusId,
  })
  if (error) throw error
  return data
}

export async function resubmitCommercialPromotion(id) {
  const { error } = await supabase.rpc('resubmit_commercial_promotion', { p_id: id })
  if (error) throw error
}

import { supabase } from '../supabase/config'
import { mapStatusRow, FEED_COLUMNS } from './statusesService'
import { mapCommunityRow } from './communitiesService'

const FEATURED_LIMIT = 6
const MY_PROMOTIONS_LIMIT = 50
const ADMIN_LIST_LIMIT = 200

function mapPromotionRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
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

// Preço/duração sempre vêm daqui (economy_config.promotionPackages), nunca digitados
// pelo cliente; o servidor revalida tudo de novo antes de debitar (create_promotion).
export async function getPromotionPackages(targetType) {
  const { data, error } = await supabase
    .from('economy_config')
    .select('config')
    .eq('id', true)
    .maybeSingle()
  if (error) throw error
  const promotionPackages = data?.config?.promotionPackages || {}
  return Object.entries(promotionPackages)
    .filter(([, pkg]) => pkg?.active === true && (!targetType || pkg?.targetType === targetType))
    .map(([packageId, pkg]) => ({ packageId, ...pkg }))
}

// requestId gerado uma vez pelo chamador e reenviado em qualquer retry -- mesmo
// mecanismo de idempotência de requestCashPurchase/createCommunityWithCash (ver
// resolveRequestId em utils/cashPurchaseFlow.js, reaproveitado pelo componente).
export async function createPromotion({ targetType, targetId, packageId, requestId }) {
  const { data, error } = await supabase.rpc('create_promotion', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_package_id: packageId,
    p_request_id: requestId,
  })
  if (error) throw error
  return data
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

// Posts usam a view com promoção validada no servidor. Comunidades usam os campos
// denormalizados no próprio alvo (promoted/promoted_until), filtrados no servidor
// (nunca limit() antes de tirar os expirados). Um post/comunidade cuja janela já
// passou simplesmente não bate mais o filtro `promoted_until > agora`.
export async function listFeaturedStatusesForCommunity(communityId) {
  const { data, error } = await supabase
    .from('status_publications')
    .select(FEED_COLUMNS)
    .eq('community_id', communityId)
    .gt('verified_promoted_until', new Date().toISOString())
    .order('verified_promoted_until', { ascending: true })
    .limit(FEATURED_LIMIT)
  if (error) throw error
  return data.map(mapStatusRow)
}

export async function listFeaturedCommunities() {
  const { data, error } = await supabase
    .from('communities')
    .select('*')
    .eq('promoted', true)
    .gt('promoted_until', new Date().toISOString())
    .order('promoted_until', { ascending: true })
    .limit(FEATURED_LIMIT)
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

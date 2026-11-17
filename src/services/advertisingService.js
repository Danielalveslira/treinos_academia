import { supabase } from '../supabase/config'
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}
export const createAdvertisingAccount = (name) =>
  rpc('create_advertising_account', { p_name: name })
export const getAdvertisingCampaigns = (accountId, after = null) =>
  rpc('get_advertising_campaigns', { p_account: accountId, p_after: after })
export const createAdvertisingCampaign = (accountId, values, requestId) =>
  rpc('create_advertising_campaign', {
    p_account: accountId,
    p_placement: values.placement,
    p_community: values.communityId || null,
    p_title: values.title,
    p_description: values.description,
    p_destination: values.destination,
    p_request_id: requestId,
  })
export const editAdvertisingCampaign = (campaign, values, submit, desiredDays = null) =>
  rpc('edit_advertising_campaign', {
    p_id: campaign.ad_id,
    p_version: campaign.version,
    p_title: values.title,
    p_description: values.description,
    p_destination: values.destination,
    p_submit: submit,
    p_media_id: values.media_id || null,
    p_desired_days: desiredDays,
  })
export const reviewAdvertisingCampaign = (campaign, approve, reason) =>
  rpc('admin_review_advertising_campaign', {
    p_id: campaign.ad_id,
    p_version: campaign.version,
    p_approve: approve,
    p_reason: reason,
  })
export const interruptAdvertisingCampaign = (campaign, reason, requestId) =>
  rpc('interrupt_advertising_campaign', {
    p_id: campaign.ad_id,
    p_reason: reason,
    p_request_id: requestId,
    p_expected_operation_id: campaign.pause_operation_id,
    p_period_start: campaign.starts_at,
  })
export const confirmAdvertisingPauseLimit = (campaign, reason) =>
  rpc('confirm_advertising_pause_limit', {
    p_id: campaign.ad_id,
    p_period_start: campaign.starts_at,
    p_expected_revision: campaign.approved_version,
    p_expected_operation_id: campaign.pause_operation_id,
    p_reason: reason,
  })
export const resumeMyAdvertisingCampaign = (campaign, requestId) =>
  rpc('resume_my_advertising_campaign', {
    p_id: campaign.ad_id,
    p_request_id: requestId,
    p_expected_operation_id: campaign.pause_operation_id,
    p_period_start: campaign.starts_at,
  })
export const getAdvertisingInventory = () => rpc('admin_advertising_inventory')
// Leitura fina pro anunciante: só {code, salesEnabled}, sem capacidade/preço/revisão (isso é
// informação administrativa). Usada pelo assistente pra só oferecer posições que de fato
// completariam uma contratação agora.
export const getAdvertisingSalesStatus = () => rpc('advertising_sales_status')
export const configureAdvertisingPlacement = (placement, values) =>
  rpc('admin_configure_advertising_placement', {
    p_code: placement.code,
    p_capacity: Number(values.capacity),
    p_sales_enabled: values.salesEnabled,
    p_delivery_enabled: values.deliveryEnabled,
    p_expected_revision: placement.revision,
    p_reason: values.reason,
    p_confirm: true,
  })
export const getAdvertisingOrders = (id, before = null) =>
  rpc('get_my_advertising_orders', { p_id: id, p_before: before })
export const getCommercialPromotions = (after = null) =>
  rpc('admin_commercial_promotions', { p_after: after })
export const reviewCommercialPromotion = (promotion, approve, reason) =>
  rpc('admin_review_commercial_promotion', {
    p_id: promotion.id,
    p_expected_revision: promotion.revision,
    p_approve: approve,
    p_reason: reason,
  })
export const resumeAdvertisingCampaign = (id, revision, reason) =>
  rpc('admin_resume_advertising_campaign', { p_id: id, p_revision: revision, p_reason: reason })
export const adminSuspendAdvertisingCampaign = (id, reason) =>
  rpc('admin_suspend_advertising_campaign', { p_id: id, p_reason: reason })
export const setAdvertisingNetwork = (codes, revision, reason) =>
  rpc('admin_set_advertising_network', {
    p_codes: codes,
    p_revision: revision,
    p_reason: reason,
    p_confirm: true,
  })
export const getCommunityAdvertisingPermissions = (id) =>
  rpc('get_community_advertising_permissions', { p_community: id })
export const configureCommunityAdvertising = (id, values) =>
  rpc('configure_community_advertising', {
    p_community: id,
    p_posts: values.posts,
    p_community_boost: values.community,
    p_revision: values.revision,
  })

export const archiveAdvertisingCampaign = (id) =>
  rpc('archive_advertising_campaign', {
    p_id: id,
    p_reason: 'Arquivamento solicitado pelo anunciante',
  })
export const getAdvertisingRevisions = (id) => rpc('get_advertising_revisions', { p_id: id })

export const getAdvertisingOperations = (before = null) =>
  rpc('admin_advertising_operations', { p_before: before })

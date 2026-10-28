import { supabase } from '../supabase/config'
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}
export const getCommercialCatalog = () => rpc('admin_commercial_catalog')
export const listCommercial = (kind, offeringCode, cursor = null) =>
  rpc('admin_list_commercial', {
    p_kind: kind,
    p_offering_code: offeringCode || null,
    p_before_id: cursor,
    p_limit: 20,
  })
export const publishCommercialPrice = (values) =>
  rpc('admin_publish_commercial_price', {
    p_offering_code: values.code,
    p_unit_price_cash: values.price,
    p_min_days: Number(values.minDays),
    p_max_days: Number(values.maxDays),
    p_active_from: values.activeFrom || null,
    p_expected_revision: values.revision,
    p_request_id: values.requestId,
    p_reason: values.reason,
    p_confirm: values.confirm,
  })
export const setCommercialSales = (values) =>
  rpc('admin_set_commercial_sales', {
    p_offering_code: values.code,
    p_enabled: values.enabled,
    p_expected_revision: values.revision,
    p_request_id: values.requestId,
    p_reason: values.reason,
    p_confirm: values.confirm,
  })
export const setCommercialEntitlement = (values) =>
  rpc('admin_set_commercial_entitlement', {
    p_entitlement_id: values.id,
    p_state: values.state,
    p_expected_revision: values.revision,
    p_request_id: values.requestId,
    p_reason: values.reason,
    p_confirm: values.confirm,
  })
export const reverseCommercialOrder = (values) =>
  rpc('admin_reverse_commercial_order', {
    p_order_id: values.id,
    p_request_id: values.requestId,
    p_reason: values.reason,
    p_confirm: values.confirm,
  })
export const quoteCommercialOrder = (resourceId, days, requestId) =>
  rpc('quote_commercial_order', {
    p_resource_id: resourceId,
    p_duration_days: days,
    p_request_id: requestId,
  })
export const confirmCommercialOrder = (orderId, confirm) =>
  rpc('confirm_commercial_order', {
    p_order_id: orderId,
    p_confirm: confirm === true,
  })
export const getMyCommercialOrder = (orderId) =>
  rpc('get_my_commercial_order', { p_order_id: orderId })

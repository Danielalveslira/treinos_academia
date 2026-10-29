import { supabase } from '../supabase/config'
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}
export const getRefundPolicy = () => rpc('get_refund_policy')
export const getRefundSource = (type, id) =>
  rpc('get_refund_source', { p_source_type: type, p_source_id: id })
export const createRefundRequest = (type, id, category, explanation, intent) =>
  rpc('create_refund_request', {
    p_source_type: type,
    p_source_id: id,
    p_category: category,
    p_explanation: explanation,
    p_intent_id: intent,
  })
export const listRefundRequests = (admin = false, cursor = null) =>
  rpc('list_refund_requests', { p_admin: admin, p_before: cursor, p_limit: 20 })
export const getRefundRequest = (id) => rpc('get_refund_request', { p_id: id })
export const actOnRefundRequest = (id, action, message, intent, revision, evidence = {}) =>
  rpc('act_on_refund_request', {
    p_id: id,
    p_action: action,
    p_message: message,
    p_intent_id: intent,
    p_revision: revision,
    p_evidence: evidence,
  })
export const getRefundBalance = () => rpc('get_refund_balance')
export const listRefundEvents = (id, before) =>
  rpc('list_refund_events', { p_id: id, p_before: before, p_limit: 50 })

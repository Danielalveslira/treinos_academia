import { supabase } from '../supabase/config'

export async function getSupplierInfoConfigured() {
  const { data, error } = await supabase
    .from('economy_config')
    .select('config')
    .eq('id', true)
    .single()
  if (error) throw error
  return data.config?.supplierInfo?.configured === true
}

export async function getSupplierInfoActivationSafety() {
  const [pricing, catalog, pending] = await Promise.all([
    supabase.rpc('admin_get_evocash_pricing'),
    supabase.rpc('admin_commercial_catalog'),
    supabase
      .from('cash_purchases')
      .select('id', { head: true, count: 'exact' })
      .eq('status', 'pending'),
  ])
  if (pricing.error) throw pricing.error
  if (catalog.error) throw catalog.error
  if (pending.error) throw pending.error
  if (
    typeof pricing.data?.quotingEnabled !== 'boolean' ||
    !Array.isArray(catalog.data?.items) ||
    catalog.data.items.some(
      (item) => typeof item.salesEnabled !== 'boolean' || typeof item.integrationReady !== 'boolean'
    ) ||
    !Number.isInteger(pending.count)
  )
    throw new Error('FINANCIAL_STATE_UNVERIFIED')
  const salesOpen = catalog.data.items.some((item) => item.salesEnabled === true)
  return { safe: pricing.data.quotingEnabled === false && !salesOpen && pending.count === 0 }
}

export async function confirmSupplierInfoConfigured(reason) {
  const safety = await getSupplierInfoActivationSafety()
  if (!safety.safe) throw new Error('FINANCIAL_GATES_OPEN')
  const { data, error } = await supabase.rpc('admin_set_supplier_info_configured', {
    p_configured: true,
    p_reason: reason,
    p_confirm: true,
  })
  if (error) throw error
  if (data?.configured !== true) throw new Error('SUPPLIER_INFO_CONFIRMATION_UNVERIFIED')
  return data
}

export async function verifySupplierInfoAudit(reason, startedAt) {
  const { data: identity, error: identityError } = await supabase.auth.getUser()
  if (identityError || !identity.user?.id) throw new Error('AUDIT_READ_FAILED')
  const { data, error } = await supabase.rpc('admin_list_audit_log', {
    p_target_user_id: null,
    p_limit: 100,
  })
  if (error) throw error
  const event =
    Array.isArray(data) &&
    data.find(
      (entry) =>
        entry.action === 'supplier_info_gate_changed' &&
        entry.reason === reason &&
        entry.metadata?.configured === true &&
        entry.admin_user_id === identity.user.id &&
        Date.parse(entry.created_at) >= startedAt - 30_000
    )
  if (!event) throw new Error('AUDIT_READ_FAILED')
  return { id: event.id, createdAt: event.created_at }
}

import { supabase } from '../supabase/config'
import { captchaOptions } from '../utils/authCaptcha'

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

export const getEvoCashPricing = () => rpc('admin_get_evocash_pricing')
export const listEvoCashPrices = (cursor = null) =>
  rpc('admin_list_evocash_prices', { p_before_revision: cursor, p_limit: 20 })
export const previewEvoCashPrice = (config, quantities, revision) =>
  rpc('admin_preview_evocash_price', {
    p_config: config,
    p_quantities: quantities,
    p_expected_revision: revision,
  })

// Password goes exclusively to Supabase Auth; never to pricing RPCs, logs or storage.
export async function reauthenticatePricingAdmin(password, captchaToken) {
  const options = captchaOptions(captchaToken)
  const { data: current, error: currentError } = await supabase.auth.getUser()
  if (currentError || !current.user?.email) throw new Error('RECENT_AUTH_REQUIRED')
  const { data, error } = await supabase.auth.signInWithPassword({
    email: current.user.email,
    password,
    ...(options && { options }),
  })
  if (error?.code === 'captcha_failed') throw error
  if (error) throw new Error('REAUTHENTICATION_FAILED')
  if (data.user?.id !== current.user.id) throw new Error('REAUTHENTICATION_FAILED')
}

export const publishEvoCashPrice = ({
  config,
  activeFrom,
  revision,
  requestId,
  reason,
  confirmLargeChange,
}) =>
  rpc('admin_publish_evocash_price', {
    p_config: config,
    p_active_from: activeFrom,
    p_expected_revision: revision,
    p_request_id: requestId,
    p_reason: reason,
    p_confirm_large_change: confirmLargeChange,
  })
export const pauseEvoCashQuotes = ({ revision, requestId, reason }) =>
  rpc('admin_pause_evocash_quotes', {
    p_expected_revision: revision,
    p_request_id: requestId,
    p_reason: reason,
  })

// Foundation for Phase 2: no payment provider or wallet mutation is performed here.
export const createEvoCashQuote = (quantity, requestId) =>
  rpc('create_evocash_purchase_quote', { p_quantity: quantity, p_request_id: requestId })

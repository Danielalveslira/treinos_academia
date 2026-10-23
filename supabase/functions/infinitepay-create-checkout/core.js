import { readLimitedJson } from '../_shared/limitedJson.js'
export function validCheckoutUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      ['checkout.infinitepay.io', 'checkout.infinitepay.com.br'].includes(url.hostname) &&
      !url.username && !url.password && !url.port
  } catch { return false }
}

export function checkoutPayload({ handle, orderNsu, label, amountCentavos, redirectUrl, webhookUrl, validUntil = null }) {
  if (!/^[a-zA-Z0-9_.-]{2,80}$/.test(handle || '') ||
      !/^evo_[0-9a-f]{32}$/.test(orderNsu || '') ||
      !Number.isSafeInteger(amountCentavos) || amountCentavos <= 0) throw new Error('INVALID_CHECKOUT_INPUT')
  return {
    handle, order_nsu: orderNsu, redirect_url: redirectUrl, webhook_url: webhookUrl,
    items: [{ quantity: 1, price: amountCentavos, description: `${label} EvoCash` }],
    ...(validUntil ? { options: { single_payment: true, valid_until: validUntil } } : {}),
  }
}

export async function createCheckout({ userClient, admin, userId, packageId, handle, appUrl, supabaseUrl, fetcher = fetch, logger = console, apiKey = null }) {
  if (typeof packageId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(packageId)) throw new Error('INVALID_REQUEST')
  const { data: access, error: accessError } = await userClient.rpc('has_app_access')
  if (accessError || access !== true) throw new Error('APP_ACCESS_DENIED')
  if (!/^[a-zA-Z0-9_.-]{2,80}$/.test(handle || '') || !appUrl || !supabaseUrl) {
    throw new Error('INFINITEPAY_NOT_CONFIGURED')
  }
  try {
    const app = new URL(appUrl)
    const backend = new URL(supabaseUrl)
    if (app.protocol !== 'https:' || backend.protocol !== 'https:' ||
        app.username || app.password || app.pathname !== '/' || app.search || app.hash ||
        backend.username || backend.password || backend.search || backend.hash) {
      throw new Error('INFINITEPAY_NOT_CONFIGURED')
    }
  } catch { throw new Error('INFINITEPAY_NOT_CONFIGURED') }
  const { data: reserved, error: reserveError } = await admin.rpc('reserve_infinitepay_cash_purchase', {
    p_user_id: userId, p_package_id: packageId,
  })
  if (reserveError) throw new Error(reserveError.message)
  if (reserved.checkoutUrl) return { id: reserved.id, checkoutUrl: reserved.checkoutUrl, status: reserved.status }
  if (!reserved.createLink) throw new Error(reserved.uncertain ? 'CHECKOUT_RECONCILIATION_REQUIRED' : 'CHECKOUT_IN_PROGRESS')
  let calledProvider = false
  try {
    const payload = checkoutPayload({
      handle, orderNsu: reserved.orderNsu, label: reserved.packageLabel,
      amountCentavos: reserved.amountCentavos,
      redirectUrl: new URL(`/evocash?checkout_return=1&purchase_id=${reserved.id}`, appUrl).toString(),
      webhookUrl: new URL('/functions/v1/infinitepay-webhook', supabaseUrl).toString(),
      // Advanced options require the merchant API key; expiry reuses the existing 7-day pending window.
      validUntil: apiKey ? reserved.checkoutValidUntil : null,
    })
    calledProvider = true
    const response = await fetcher('https://api.checkout.infinitepay.io/links', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'X-Api-Key': apiKey } : {}) },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(12000),
    })
    const body = await readLimitedJson(response, { maxBytes: 65536 }).catch(() => null)
    if (!response.ok) {
      const providerCode = typeof body?.code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.code)
        ? body.code : null
      logger.warn('[InfinitePay links] rejected', { status: response.status, providerCode,
        responseKeys: body && typeof body === 'object' ? Object.keys(body).slice(0, 12) : [] })
      const error = new Error('INFINITEPAY_LINK_FAILED')
      error.providerStatus = response.status
      error.providerCode = providerCode
      error.definitive = response.status >= 400 && response.status < 500 &&
        response.status !== 408 && response.status !== 429
      throw error
    }
    if (!validCheckoutUrl(body?.url)) {
      logger.warn('[InfinitePay links] invalid URL', { status: response.status,
        responseKeys: body && typeof body === 'object' ? Object.keys(body).slice(0, 12) : [],
        returnedHost: typeof body?.url === 'string' ? safeHostname(body.url) : null })
      throw new Error('INVALID_CHECKOUT_URL')
    }
    logger.info?.('[InfinitePay links] checkout URL accepted', { status: response.status,
      returnedHost: new URL(body.url).hostname })
    const { error: saveError } = await admin.rpc('finish_infinitepay_checkout', {
      p_purchase_id: reserved.id, p_checkout_url: body.url,
    })
    if (saveError) throw new Error('CHECKOUT_SAVE_FAILED')
    return { id: reserved.id, checkoutUrl: body.url, status: 'pending' }
  } catch (error) {
    try {
      const rpc = !calledProvider ? 'release_infinitepay_checkout' :
        error.definitive ? 'fail_infinitepay_checkout' : 'mark_infinitepay_checkout_uncertain'
      const params = rpc === 'fail_infinitepay_checkout'
        ? { p_purchase_id: reserved.id, p_http_status: error.providerStatus }
        : { p_purchase_id: reserved.id }
      const { error: stateError } = await admin.rpc(rpc, params)
      if (stateError) logger.error('[InfinitePay links] state update failed', { rpc, code: stateError.code })
    } catch { /* best effort */ }
    throw error
  }
}

function safeHostname(value) {
  try { return new URL(value).hostname.slice(0, 100) } catch { return null }
}

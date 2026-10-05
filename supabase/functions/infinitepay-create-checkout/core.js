export function validCheckoutUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'checkout.infinitepay.com.br' &&
      !url.username && !url.password && !url.port
  } catch { return false }
}

export function checkoutPayload({ handle, orderNsu, label, amountCentavos, redirectUrl, webhookUrl }) {
  if (!/^[a-zA-Z0-9_.-]{2,80}$/.test(handle || '') ||
      !/^evo_[0-9a-f]{32}$/.test(orderNsu || '') ||
      !Number.isSafeInteger(amountCentavos) || amountCentavos <= 0) throw new Error('INVALID_CHECKOUT_INPUT')
  return {
    handle, order_nsu: orderNsu, redirect_url: redirectUrl, webhook_url: webhookUrl,
    items: [{ quantity: 1, price: amountCentavos, description: `${label} EvoCash` }],
  }
}

export async function createCheckout({ userClient, admin, userId, packageId, handle, appUrl, supabaseUrl, fetcher = fetch }) {
  if (typeof packageId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(packageId)) throw new Error('INVALID_REQUEST')
  const { data: access, error: accessError } = await userClient.rpc('has_app_access')
  if (accessError || access !== true) throw new Error('APP_ACCESS_DENIED')
  if (!handle || !appUrl || !supabaseUrl) throw new Error('INFINITEPAY_NOT_CONFIGURED')
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
  if (!reserved.createLink) throw new Error('CHECKOUT_IN_PROGRESS')
  let calledProvider = false
  try {
    const payload = checkoutPayload({
      handle, orderNsu: reserved.orderNsu, label: reserved.packageLabel,
      amountCentavos: reserved.amountCentavos,
      redirectUrl: new URL(`/evocash?checkout_return=1&purchase_id=${reserved.id}`, appUrl).toString(),
      webhookUrl: new URL('/functions/v1/infinitepay-webhook', supabaseUrl).toString(),
    })
    calledProvider = true
    const response = await fetcher('https://api.checkout.infinitepay.io/links', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) throw new Error('INFINITEPAY_LINK_FAILED')
    const body = await response.json()
    if (!validCheckoutUrl(body?.url)) throw new Error('INVALID_CHECKOUT_URL')
    const { error: saveError } = await admin.rpc('finish_infinitepay_checkout', {
      p_purchase_id: reserved.id, p_checkout_url: body.url,
    })
    if (saveError) throw new Error('CHECKOUT_SAVE_FAILED')
    return { id: reserved.id, checkoutUrl: body.url, status: 'pending' }
  } catch (error) {
    try {
      await admin.rpc(calledProvider ? 'mark_infinitepay_checkout_uncertain' : 'release_infinitepay_checkout',
        { p_purchase_id: reserved.id })
    } catch { /* best effort */ }
    throw error
  }
}

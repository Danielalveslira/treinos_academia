import { readLimitedJson } from './limitedJson.js'
const NSU = /^[a-zA-Z0-9_-]{1,128}$/
const ORDER = /^evo_[0-9a-f]{32}$/

export function paymentHint(input) {
  const orderNsu = input?.order_nsu
  const transactionNsu = input?.transaction_nsu
  const invoiceSlug = input?.invoice_slug ?? input?.slug
  if (typeof orderNsu !== 'string' || typeof transactionNsu !== 'string' || typeof invoiceSlug !== 'string' || !ORDER.test(orderNsu || '') || !NSU.test(transactionNsu || '') || !NSU.test(invoiceSlug || '')) {
    throw new Error('INVALID_PAYMENT_HINT')
  }
  return { orderNsu, transactionNsu, invoiceSlug }
}

export async function verifyAndConfirm({ admin, handle, hint, userId = null, fetcher = fetch, apiKey = null }) {
  if (!handle) throw new Error('INFINITEPAY_NOT_CONFIGURED')
  let query = admin.from('cash_purchases')
    .select('id,payment_provider,provider_order_nsu,provider_transaction_nsu,provider_invoice_slug,package_id,amount_centavos,currency,status,review_resolution')
    .eq('provider_order_nsu', hint.orderNsu).eq('payment_provider', 'infinitepay')
  if (userId) query = query.eq('user_id', userId)
  const { data: purchase, error: lookupError } = await query.maybeSingle()
  if (lookupError || !purchase) throw new Error('PURCHASE_NOT_FOUND')
  const identityConflict = !!((purchase.provider_transaction_nsu && purchase.provider_transaction_nsu !== hint.transactionNsu) ||
    (purchase.provider_invoice_slug && purchase.provider_invoice_slug !== hint.invoiceSlug))
  if (!identityConflict && purchase.status !== 'checkout_failed') {
    if (purchase.review_resolution === 'refunded_externally') return { status: 'cancelled', confirmed: true }
    if (!['pending', 'cancelled'].includes(purchase.status)) return { status: purchase.status,
      confirmed: ['credited', 'held_in_case', 'needs_review'].includes(purchase.status) }
  }
  const { data: claimed, error: claimError } = await admin.rpc('claim_infinitepay_payment_check', { p_purchase_id: purchase.id })
  if (claimError) throw new Error('PAYMENT_CHECK_FAILED')
  if (!claimed) return { status: purchase.status, confirmed: false }
  const response = await fetcher('https://api.checkout.infinitepay.io/payment_check', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'X-Api-Key': apiKey } : {}) },
    body: JSON.stringify({ handle, order_nsu: hint.orderNsu,
      transaction_nsu: hint.transactionNsu, slug: hint.invoiceSlug }),
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error('PAYMENT_CHECK_FAILED')
  const check = await readLimitedJson(response, { maxBytes: 65536 })
  if (check?.success !== true || check?.paid !== true) return { status: purchase.status, confirmed: false }
  if (!Number.isSafeInteger(check.amount) || check.amount !== purchase.amount_centavos ||
      (check.currency !== undefined && check.currency !== 'BRL') ||
      (check.order_nsu !== undefined && check.order_nsu !== hint.orderNsu) ||
      (check.transaction_nsu !== undefined && check.transaction_nsu !== hint.transactionNsu) ||
      (check.slug !== undefined && check.slug !== hint.invoiceSlug) ||
      (check.invoice_slug !== undefined && check.invoice_slug !== hint.invoiceSlug) ||
      purchase.currency !== 'BRL' || !purchase.package_id ||
      !['pix', 'credit_card'].includes(check.capture_method)) throw new Error('PAYMENT_MISMATCH')
  if (identityConflict || purchase.status === 'checkout_failed') {
    const { error } = await admin.rpc('record_infinitepay_verified_conflict', {
      p_purchase_id: purchase.id, p_order_nsu: hint.orderNsu, p_transaction_nsu: hint.transactionNsu,
      p_invoice_slug: hint.invoiceSlug, p_amount_centavos: check.amount,
    })
    if (error) throw new Error('PAYMENT_REVIEW_RECORD_FAILED')
    return { status: 'needs_review', confirmed: true }
  }
  const { data: result, error: confirmError } = await admin.rpc('confirm_infinitepay_cash_purchase', {
    p_purchase_id: purchase.id, p_order_nsu: hint.orderNsu,
    p_transaction_nsu: hint.transactionNsu, p_invoice_slug: hint.invoiceSlug,
    p_amount_centavos: check.amount, p_capture_method: check.capture_method,
    p_receipt_url: null,
  })
  if (confirmError) throw new Error(confirmError.message)
  if (result?.reason === 'held_in_financial_case' || result?.reason === 'already_held_in_case') {
    return { status: 'held_in_case', confirmed: true }
  }
  if (result?.credited === true || result?.reason === 'already_credited') {
    return { status: 'credited', confirmed: true }
  }
  if (['needs_review', 'already_needs_review'].includes(result?.reason)) return { status: 'needs_review', confirmed: true }
  if (result?.reason === 'refunded_externally') return { status: 'cancelled', confirmed: true }
  throw new Error('PAYMENT_NOT_SETTLED')
}

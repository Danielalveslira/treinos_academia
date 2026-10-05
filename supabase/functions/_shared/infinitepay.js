const NSU = /^[a-zA-Z0-9_-]{1,128}$/
const ORDER = /^evo_[0-9a-f]{32}$/

export function paymentHint(input) {
  const orderNsu = input?.order_nsu
  const transactionNsu = input?.transaction_nsu
  const invoiceSlug = input?.invoice_slug ?? input?.slug
  if (!ORDER.test(orderNsu || '') || !NSU.test(transactionNsu || '') || !NSU.test(invoiceSlug || '')) {
    throw new Error('INVALID_PAYMENT_HINT')
  }
  return { orderNsu, transactionNsu, invoiceSlug }
}

export async function verifyAndConfirm({ admin, handle, hint, userId = null, fetcher = fetch }) {
  if (!handle) throw new Error('INFINITEPAY_NOT_CONFIGURED')
  let query = admin.from('cash_purchases')
    .select('id,payment_provider,provider_order_nsu,provider_transaction_nsu,provider_invoice_slug,package_id,amount_centavos,currency,status')
    .eq('provider_order_nsu', hint.orderNsu).eq('payment_provider', 'infinitepay')
  if (userId) query = query.eq('user_id', userId)
  const { data: purchase, error: lookupError } = await query.maybeSingle()
  if (lookupError || !purchase) throw new Error('PURCHASE_NOT_FOUND')
  if (purchase.provider_transaction_nsu && purchase.provider_transaction_nsu !== hint.transactionNsu) throw new Error('TRANSACTION_MISMATCH')
  if (purchase.provider_invoice_slug && purchase.provider_invoice_slug !== hint.invoiceSlug) throw new Error('INVOICE_MISMATCH')
  if (!['pending', 'cancelled'].includes(purchase.status)) return { status: purchase.status,
    confirmed: ['credited', 'held_in_case'].includes(purchase.status) }
  const response = await fetcher('https://api.checkout.infinitepay.io/payment_check', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, order_nsu: hint.orderNsu,
      transaction_nsu: hint.transactionNsu, slug: hint.invoiceSlug }),
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error('PAYMENT_CHECK_FAILED')
  const check = await response.json()
  if (check?.success !== true || check?.paid !== true) return { status: purchase.status, confirmed: false }
  if (!Number.isSafeInteger(check.amount) || check.amount !== purchase.amount_centavos ||
      purchase.currency !== 'BRL' || !purchase.package_id ||
      !['pix', 'credit_card'].includes(check.capture_method)) throw new Error('PAYMENT_MISMATCH')
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
  throw new Error('PAYMENT_NOT_SETTLED')
}

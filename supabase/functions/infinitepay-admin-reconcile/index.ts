// Operator fallback for a pending InfinitePay purchase whose own webhook/check-payment
// path never ran (e.g. the buyer's account was disabled before returning to /evocash).
// The admin looks the order up on the InfinitePay merchant dashboard, copies its
// transaction_nsu/invoice_slug, and this function reuses the exact same verifyAndConfirm
// logic the webhook and infinitepay-check-payment already rely on -- no separate credit
// path is introduced. confirm_infinitepay_cash_purchase decides what happens next
// (credit, hold in financial case, or park as needs_review for a disabled account).
import { corsHeaders } from '../_shared/cors.ts'
import { paymentHint, verifyAndConfirm } from '../_shared/infinitepay.js'
import { authenticateSuperadmin, jsonError, jsonOk, UUID_PATTERN } from '../_shared/superadminAuth.ts'

const handle = Deno.env.get('INFINITEPAY_HANDLE')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('METHOD_NOT_ALLOWED', 405)
  try {
    const auth = await authenticateSuperadmin(req)
    if (auth instanceof Response) return auth
    const { adminClient } = auth

    const body = await req.json()
    if (!UUID_PATTERN.test(String(body?.purchaseId || ''))) return jsonError('INVALID_REQUEST', 400)

    const { data: purchase, error } = await adminClient
      .from('cash_purchases')
      .select('id,payment_provider,provider_order_nsu')
      .eq('id', body.purchaseId)
      .maybeSingle()
    if (error || !purchase || purchase.payment_provider !== 'infinitepay') {
      return jsonError('PURCHASE_NOT_FOUND', 404)
    }

    let hint
    try {
      hint = paymentHint({
        order_nsu: purchase.provider_order_nsu,
        transaction_nsu: body.transactionNsu,
        invoice_slug: body.invoiceSlug,
      })
    } catch {
      return jsonError('INVALID_PAYMENT_HINT', 400)
    }

    const result = await verifyAndConfirm({ admin: adminClient, handle, hint })
    return jsonOk({ status: result.status, confirmed: result.confirmed })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR'
    console.warn('[InfinitePay admin reconcile] rejected:', code)
    const known = [
      'PURCHASE_NOT_FOUND', 'TRANSACTION_MISMATCH', 'INVOICE_MISMATCH', 'PAYMENT_CHECK_FAILED',
      'PAYMENT_MISMATCH', 'PAYMENT_NOT_SETTLED', 'INFINITEPAY_NOT_CONFIGURED',
    ]
    return jsonError(known.includes(code) ? code : 'INTERNAL_ERROR', known.includes(code) ? 400 : 500)
  }
})

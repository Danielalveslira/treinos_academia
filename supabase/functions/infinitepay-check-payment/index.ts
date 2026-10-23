import { readLimitedJson, bodyErrorStatus } from '../_shared/limitedJson.js'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { paymentHint, verifyAndConfirm } from '../_shared/infinitepay.js'

const url = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const handle = Deno.env.get('INFINITEPAY_HANDLE')
const apiKey = Deno.env.get('INFINITEPAY_API_KEY')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return reply({ status: 'ok' }, 200)
  if (req.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405)
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return reply({ error: 'NOT_AUTHENTICATED' }, 401)
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return reply({ error: 'NOT_AUTHENTICATED' }, 401)
    const { data: sessionActive, error: sessionError } = await userClient.rpc('is_session_active')
    if (sessionError || sessionActive !== true) return reply({ error: 'SESSION_REVOKED' }, 401)
    const body = await readLimitedJson(req)
    if (typeof body?.purchaseId !== 'string') return reply({ error: 'INVALID_REQUEST' }, 400)
    const { data: purchase, error } = await admin.from('cash_purchases')
      .select('id,user_id,status,payment_provider,provider_order_nsu')
      .eq('id', body.purchaseId).eq('user_id', userData.user.id).maybeSingle()
    if (error || !purchase || purchase.payment_provider !== 'infinitepay') return reply({ error: 'PURCHASE_NOT_FOUND' }, 404)
    if (!['pending', 'cancelled'].includes(purchase.status)) return reply({ status: purchase.status }, 200)
    if (!body.order_nsu || !body.transaction_nsu || !(body.slug || body.invoice_slug)) return reply({ status: purchase.status }, 200)
    const hint = paymentHint(body)
    if (hint.orderNsu !== purchase.provider_order_nsu) return reply({ error: 'PAYMENT_MISMATCH' }, 400)
    const result = await verifyAndConfirm({ admin, handle, apiKey, hint, userId: userData.user.id })
    return reply({ status: result.status }, 200)
  } catch (error) {
    console.warn('[InfinitePay check] rejected')
    return reply({ error: 'PAYMENT_NOT_CONFIRMED' }, bodyErrorStatus(error))
  }
})

function reply(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

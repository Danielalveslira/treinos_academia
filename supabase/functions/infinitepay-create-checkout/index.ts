import { readLimitedJson, bodyErrorStatus } from '../_shared/limitedJson.js'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { createCheckout } from './core.js'

const url = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const handle = Deno.env.get('INFINITEPAY_HANDLE')
const appUrl = Deno.env.get('APP_PUBLIC_URL')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ error: 'NOT_AUTHENTICATED' }, 401)
    const body = await readLimitedJson(req)
    if (!body || Object.keys(body).some((key) => !['quoteId','requestId'].includes(key))) return json({ error: 'INVALID_REQUEST' }, 400)
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
    const { data, error } = await userClient.auth.getUser()
    if (error || !data.user) return json({ error: 'NOT_AUTHENTICATED' }, 401)
    const { data: fullSession, error: sessionError } = await userClient.rpc('is_full_login_session')
    if (sessionError || fullSession !== true) return json({ error: 'APP_ACCESS_DENIED' }, 403)
    const admin = createClient(url, serviceKey)
    const result = await createCheckout({ userClient, admin, quoteId: body.quoteId, requestId: body.requestId,
      enabled: Deno.env.get('INFINITEPAY_CHECKOUT_ENABLED') === 'true', handle, apiKey: Deno.env.get('INFINITEPAY_API_KEY'), appUrl, supabaseUrl: url })
    return json(result, 200)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR'
    const safe = ['INVALID_REQUEST', 'APP_ACCESS_DENIED', 'INFINITEPAY_NOT_CONFIGURED',
      'PENDING_CASH_PURCHASE_EXISTS', 'CHECKOUT_IN_PROGRESS', 'EVOCASH_PURCHASES_PAUSED',
      'QUOTE_NOT_FOUND','QUOTE_EXPIRED','QUOTE_ALREADY_RESERVED','PURCHASE_ALREADY_FINAL','CHECKOUT_EXPIRED',
      'IDEMPOTENCY_CONFLICT','PURCHASE_LIMIT_REACHED','CHECKOUT_RATE_LIMIT',
      'INFINITEPAY_LINK_FAILED', 'INVALID_CHECKOUT_URL', 'CHECKOUT_SAVE_FAILED',
      'CHECKOUT_RECONCILIATION_REQUIRED']
    if (!safe.includes(code)) console.error('[InfinitePay create] unexpected error class:', error?.constructor?.name)
    const providerStatus = error instanceof Error && 'providerStatus' in error
      ? Number(error.providerStatus) : null
    const providerCode = error instanceof Error && 'providerCode' in error &&
      typeof error.providerCode === 'string' ? error.providerCode : null
    return json({ error: safe.includes(code) ? code : 'INTERNAL_ERROR',
      ...(providerStatus ? { providerStatus } : {}),
      ...(providerCode ? { providerCode } : {}) }, code === 'CHECKOUT_IN_PROGRESS' ? 409 : bodyErrorStatus(error))
  }
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

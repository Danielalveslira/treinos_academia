import { readLimitedJson, bodyErrorStatus } from '../_shared/limitedJson.js'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { paymentHint, verifyAndConfirm } from '../_shared/infinitepay.js'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const handle = Deno.env.get('INFINITEPAY_HANDLE')
const apiKey = Deno.env.get('INFINITEPAY_API_KEY')

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(false, 405)
  try {
    const hint = paymentHint(await readLimitedJson(req))
    const result = await verifyAndConfirm({ admin, handle, apiKey, hint })
    return reply(result.confirmed, result.confirmed ? 200 : 400)
  } catch (error) {
    console.warn('[InfinitePay webhook] rejected')
    return reply(false, bodyErrorStatus(error))
  }
})

function reply(success: boolean, status: number) {
  return new Response(JSON.stringify({ success, message: success ? null : 'Pagamento não confirmado' }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

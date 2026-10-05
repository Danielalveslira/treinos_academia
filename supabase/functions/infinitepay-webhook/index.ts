import { createClient } from 'jsr:@supabase/supabase-js@2'
import { paymentHint, verifyAndConfirm } from '../_shared/infinitepay.js'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const handle = Deno.env.get('INFINITEPAY_HANDLE')

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(false, 405)
  try {
    if (Number(req.headers.get('content-length') || 0) > 16384) return reply(false, 413)
    const hint = paymentHint(await req.json())
    const result = await verifyAndConfirm({ admin, handle, hint })
    return reply(result.confirmed, result.confirmed ? 200 : 400)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR'
    console.warn('[InfinitePay webhook] rejected:', code)
    return reply(false, 400)
  }
})

function reply(success: boolean, status: number) {
  return new Response(JSON.stringify({ success, message: success ? null : 'Pagamento não confirmado' }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

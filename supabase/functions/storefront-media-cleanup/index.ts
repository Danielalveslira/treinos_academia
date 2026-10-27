import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
const url = Deno.env.get('SUPABASE_URL')!,
  anon = Deno.env.get('SUPABASE_ANON_KEY')!,
  secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const headers = { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers, status })
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({})
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'NOT_AUTHENTICATED' }, 401)
  const service = auth === `Bearer ${secret}`
  const admin = createClient(url, secret, { auth: { persistSession: false } })
  const caller = service
    ? admin
    : createClient(url, anon, {
        global: { headers: { Authorization: auth } },
        auth: { persistSession: false },
      })
  if (!service && (await caller.auth.getUser()).error)
    return json({ error: 'NOT_AUTHENTICATED' }, 401)
  try {
    // Ignore arbitrary paths/IDs in the body. PostgreSQL selects a bounded, leased batch.
    const batch = await caller.rpc('claim_storefront_media_cleanup', { p_limit: 20 })
    if (batch.error) return json({ error: 'MAINTENANCE_NOT_AUTHORIZED' }, 403)
    let completed = 0,
      failed = 0
    for (const item of batch.data || []) {
      const removed = await admin.storage.from('storefront-media').remove([item.path])
      const result = await admin.rpc('finish_storefront_media_cleanup', {
        p_id: item.id,
        p_token: item.token,
        p_success: !removed.error,
      })
      if (removed.error || result.error || !result.data) failed++
      else completed++
    }
    return json({ claimed: batch.data.length, completed, failed })
  } catch {
    return json({ error: 'MAINTENANCE_FAILED' }, 503)
  }
})

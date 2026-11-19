// Todas as Edge Functions administrativas usam a mesma autorização do banco.
// is_superadmin() inclui sessão ativa, escopo completo e AAL2 quando habilitado.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from './cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  })
}

export function jsonError(code: string, status: number) {
  return new Response(JSON.stringify({ error: code }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

export async function authenticateSuperadmin(
  req: Request
): Promise<{ uid: string; adminClient: SupabaseClient } | Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonError('NOT_AUTHENTICATED', 401)

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) return jsonError('NOT_AUTHENTICATED', 401)
  const uid = userData.user.id
  const { data: authorized, error: authError } = await userClient.rpc('is_superadmin')
  if (authError || authorized !== true) return jsonError('FORBIDDEN', 403)

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  return { uid, adminClient }
}

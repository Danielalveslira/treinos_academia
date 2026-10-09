// Autenticação das Edge Functions administrativas de mídia dos exercícios: JWT válido E papel
// superadmin (a única "role" administrativa do projeto -- ver public.is_superadmin()). O papel é
// lido com o service_role na tabela users (nunca de um claim do cliente).
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

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: profile, error: profileErr } = await adminClient
    .from('users')
    .select('role')
    .eq('id', uid)
    .maybeSingle()
  if (profileErr || profile?.role !== 'superadmin') return jsonError('FORBIDDEN', 403)

  return { uid, adminClient }
}

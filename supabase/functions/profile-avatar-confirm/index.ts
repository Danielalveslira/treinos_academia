// Equivalente a confirm(uid, mediaId) (functions/profile-avatar-service.js). Chamada
// pelo cliente (JWT do próprio dono) depois de subir os bytes direto pro Storage (RLS já
// travou o insert num caminho pré-alocado por allocate_profile_avatar). Só esta função
// decodifica a imagem pra validar dimensões -- Postgres não faz isso, e o navegador que
// fez o upload não é confiável pra "declarar" as próprias dimensões (é exatamente essa
// checagem servidor que o original tinha via sharp().metadata()).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { readWebpDimensions } from '../_shared/webp.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MAX_BYTES = 1024 * 1024
const MAX_DIMENSION = 1600
const MAX_PIXELS = 2560000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('NOT_AUTHENTICATED', 401)

    const { mediaId } = await req.json()
    if (!/^[0-9a-f-]{36}$/i.test(String(mediaId || ''))) {
      return jsonError('INVALID_ARGUMENT', 400)
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return jsonError('NOT_AUTHENTICATED', 401)
    const uid = userData.user.id

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: media, error: mediaErr } = await adminClient
      .from('profile_avatar_media')
      .select('id, owner_id, storage_path, state')
      .eq('id', mediaId)
      .maybeSingle()
    if (mediaErr || !media || media.owner_id !== uid || media.state !== 'allocated') {
      return jsonError('UPLOAD_NOT_AUTHORIZED', 403)
    }

    const { data: blob, error: downloadErr } = await adminClient.storage
      .from('profile-avatars')
      .download(media.storage_path)
    if (downloadErr || !blob) {
      return jsonError('INVALID_IMAGE', 400)
    }
    if (blob.size < 1 || blob.size > MAX_BYTES) {
      return jsonError('INVALID_IMAGE', 400)
    }

    const bytes = new Uint8Array(await blob.arrayBuffer())
    const dimensions = readWebpDimensions(bytes)
    if (
      !dimensions ||
      dimensions.width <= 0 ||
      dimensions.height <= 0 ||
      dimensions.width > MAX_DIMENSION ||
      dimensions.height > MAX_DIMENSION ||
      dimensions.width * dimensions.height > MAX_PIXELS
    ) {
      return jsonError('INVALID_IMAGE', 400)
    }

    const { data: result, error: confirmErr } = await adminClient.rpc(
      'confirm_profile_avatar_internal',
      { p_media_id: mediaId, p_width: dimensions.width, p_height: dimensions.height }
    )
    if (confirmErr) {
      console.error('[profile-avatar-confirm] confirm_profile_avatar_internal failed:', confirmErr)
      return jsonError(confirmErr.message === 'UPLOAD_NOT_AUTHORIZED' ? 'UPLOAD_NOT_AUTHORIZED' : 'INTERNAL_ERROR', 400)
    }

    return jsonOk(result)
  } catch (error) {
    console.error('[profile-avatar-confirm] unexpected error:', error)
    return jsonError('INTERNAL_ERROR', 500)
  }
})

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  })
}

function jsonError(code: string, status: number) {
  return new Response(JSON.stringify({ error: code }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

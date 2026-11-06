// Equivalente a confirm(uid, mediaId) (functions/profile-avatar-service.js). Chamada
// pelo cliente (JWT do próprio dono) depois de subir os bytes direto pro Storage (RLS já
// travou o insert num caminho pré-alocado por allocate_profile_avatar). Só esta função
// valida o contêiner WebP e as dimensões declaradas no cabeçalho -- Postgres não faz
// isso, e o navegador que fez o upload não é confiável pra declarar metadados.
// Esta verificação não substitui uma decodificação completa da imagem.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { readWebpDimensions, isWebpComplete, findForbiddenWebpChunk } from '../_shared/webp.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MAX_BYTES = 1024 * 1024
const AVATAR_DIMENSION = 320

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
    const { data: hasAccess, error: accessErr } = await userClient.rpc('has_app_access')
    if (accessErr || hasAccess !== true) return jsonError('APP_ACCESS_DENIED', 403)

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: media, error: mediaErr } = await adminClient
      .from('profile_avatar_media')
      .select('id, owner_id, storage_path, state')
      .eq('id', mediaId)
      .maybeSingle()
    if (mediaErr || !media || media.owner_id !== uid) {
      return jsonError('UPLOAD_NOT_AUTHORIZED', 403)
    }

    // The first confirmation may commit while its HTTP response is lost. Repeating
    // that same media ID is safe only while it is still the owner's active avatar.
    if (media.state === 'active') {
      const { data: owner, error: ownerErr } = await adminClient
        .from('users')
        .select('avatar_media_id')
        .eq('id', uid)
        .maybeSingle()
      if (!ownerErr && owner?.avatar_media_id === mediaId) {
        return jsonOk({ mediaId, path: media.storage_path })
      }
      return jsonError('UPLOAD_NOT_AUTHORIZED', 403)
    }
    if (media.state !== 'allocated') return jsonError('UPLOAD_NOT_AUTHORIZED', 403)

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
    const dimensions = isWebpComplete(bytes) && !findForbiddenWebpChunk(bytes)
      ? readWebpDimensions(bytes) : null
    if (
      !dimensions ||
      dimensions.width !== AVATAR_DIMENSION ||
      dimensions.height !== AVATAR_DIMENSION
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

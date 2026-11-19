// Fase 2 de publish() (ver nota no topo de 20260929000005_professional_listings.sql):
// chamada pelo cliente (JWT do próprio dono) depois que prepare_professional_listing_publish
// (Fase 1, RPC direta) já travou o rascunho em 'publishing'. Esta função nunca aceita
// owner_id, avatarMediaId ou avatarPath do cliente -- re-deriva os dois do uid já
// validado pelo JWT, lendo o estado ATUAL de public.users (nunca o snapshot da Fase 1:
// o avatar pode ter mudado entre as duas chamadas -- evitar isso é o motivo desta
// revalidação, igual à nota original do finalize_professional_listing_publish).
//
// Não existe cópia de arquivo: finalize_professional_listing_publish só aceita
// p_avatar_path == profile_avatar_media.storage_path do próprio media_id (recusa
// qualquer outro valor com AVATAR_AUTHORIZATION_CHANGED) e grava esse MESMO caminho
// privado em published_professional_listings.avatar_path -- a leitura pública depende
// de uma policy em storage.objects que libera esse caminho exato enquanto (e só
// enquanto) ele estiver referenciado por uma vitrine publicada (ver migration
// 20261001000003_professional_listing_avatar_publish.sql), não de duplicar bytes.
//
// finalize_professional_listing_publish/abort_professional_listing_publish são
// REVOGADAS de public/anon/authenticated -- só esta função, com a service role, as chama.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { finalizedOperationResult, resolveAuthorizedAvatar } from './publishState.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  let listingId = ''
  let operationId = ''

  // Libera a trava 'publishing' sempre que algo dá errado depois da Fase 1 -- nunca
  // deixa a vitrine presa (a própria RPC só mexe na linha se listing_id+operation_id
  // baterem exatamente, então chamar isto sem necessidade nunca afeta outra tentativa).
  async function abortSafely() {
    if (!listingId || !operationId) return
    try {
      const { error } = await adminClient.rpc('abort_professional_listing_publish', {
        p_listing_id: listingId,
        p_operation_id: operationId,
      })
      if (error) console.error('[finalize-professional-listing-publish] abort failed:', error)
    } catch (error) {
      console.error('[finalize-professional-listing-publish] abort failed:', error)
    }
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('NOT_AUTHENTICATED', 401)

    const body = await req.json()
    listingId = String(body?.listingId || '')
    operationId = String(body?.operationId || '')
    if (!/^[0-9a-f-]{36}$/i.test(listingId)) return jsonError('INVALID_ARGUMENT', 400)
    if (operationId.length === 0) return jsonError('INVALID_ARGUMENT', 400)

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return jsonError('NOT_AUTHENTICATED', 401)
    const { data: fullSession, error: sessionErr } = await userClient.rpc('is_full_login_session')
    if (sessionErr || fullSession !== true) return jsonError('NOT_AUTHENTICATED', 401)
    const uid = userData.user.id

    // Nunca confia em owner_id do cliente -- só no uid resolvido pelo próprio JWT.
    const { data: listing, error: listingErr } = await adminClient
      .from('professional_listings')
      .select('id, owner_id, lifecycle_state, published_version')
      .eq('id', listingId)
      .maybeSingle()
    if (listingErr || !listing || listing.owner_id !== uid) {
      return jsonError('LISTING_NOT_FOUND', 404)
    }

    const { data: draft, error: draftErr } = await adminClient
      .from('professional_listing_drafts')
      .select('use_profile_avatar, kind, review_state, publishing_operation_id, publish_operation_id')
      .eq('listing_id', listingId)
      .maybeSingle()
    const finalized = finalizedOperationResult(listing, draft, operationId)
    if (finalized) return jsonOk(finalized)
    if (
      draftErr ||
      !draft ||
      draft.review_state !== 'publishing' ||
      draft.publishing_operation_id !== operationId
    ) {
      // Cobre tanto um retry tardio (outra tentativa já finalizou ou reabriu o
      // rascunho) quanto uma chamada fora de ordem (Fase 2 sem Fase 1 correspondente)
      // -- os dois são "nada aqui pra finalizar com este operationId", nunca uma
      // publicação dupla.
      await abortSafely()
      return jsonError('PUBLISH_STATE_CHANGED', 409)
    }

    let owner: { avatar_media_id: string | null; avatar_path: string | null } | null = null
    if (draft.kind === 'professional' && draft.use_profile_avatar === true) {
      const { data } = await adminClient
        .from('users')
        .select('avatar_media_id, avatar_path')
        .eq('id', uid)
        .maybeSingle()
      owner = data
      // Sem avatar autorizado agora: publica normalmente, sem foto (avatarPath fica
      // null) -- mesma regra de "sem avatar, publica com o padrão" do original.
      // finalize_professional_listing_publish revalida owner/state do media_id de
      // qualquer forma (AVATAR_AUTHORIZATION_CHANGED se mudou entre a Fase 1 e esta).
    }
    const { avatarPath, avatarSourceMediaId } = resolveAuthorizedAvatar(draft, owner)

    const { data: result, error: finalizeErr } = await adminClient.rpc(
      'finalize_professional_listing_publish',
      {
        p_listing_id: listingId,
        p_operation_id: operationId,
        p_avatar_path: avatarPath,
        p_avatar_source_media_id: avatarSourceMediaId,
      }
    )
    if (finalizeErr) {
      console.error('[finalize-professional-listing-publish] finalize failed:', finalizeErr)
      await abortSafely()
      return jsonError(finalizeErr.message || 'FINALIZE_FAILED', 400)
    }

    return jsonOk(result)
  } catch (error) {
    console.error('[finalize-professional-listing-publish] unexpected error:', error)
    await abortSafely()
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

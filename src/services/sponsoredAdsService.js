import { adAuthorizationDeadline } from '../utils/adAuthorization'
import { supabase } from '../supabase/config'

// Um anúncio só aparece nas comunidades listadas em communityIds — NUNCA em todas por
// padrão. A ausência de uma comunidade nessa lista não é um bug a corrigir; é o
// comportamento esperado. RLS (ver migration 20260929000006_sponsored_ads.sql) reforça
// essa mesma filtragem no servidor (não só confia neste arquivo).

function toDoc(row, requestStartedAt = performance.now()) {
  return {
    id: row.id,
    partnerName: row.partner_name,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    mediaId: row.media_id,
    ctaLabel: row.cta_label,
    ctaType: row.cta_type,
    ctaTarget: row.cta_target,
    expiresAt: row.expires_at,
    authorizationUntil: adAuthorizationDeadline(row.expires_at, row.server_time, requestStartedAt),
    communityIds: row.community_ids ?? [],
    isGlobal: row.is_global,
    displayMode: row.display_mode,
    createdBy: row.created_by,
    createdAt: row.created_at,
    // Total elegível no instante da consulta, ANTES da amostra aleatória de `display_limit`
    // ser recortada (ver select_advertising); o fallback cobre respostas antigas.
    eligibleTotal: row.eligible_total ?? null,
  }
}

// Consulta usada pelas telas de comunidade (card no feed / banner rotativo). expiresAt e
// displayMode são filtrados no client logo depois deste fetch (ver useSponsoredAds.js).
export async function listSponsoredAdsForCommunity(communityId) {
  const results = await Promise.all(
    ['community_banner', 'community_feed'].map(async (placement) => {
      const requestStartedAt = performance.now()
      const { data, error } = await supabase.rpc('select_advertising', {
        p_placement: placement,
        p_context: communityId,
      })
      if (error) throw error
      return data.map((row) =>
        toDoc(
          { ...row, display_mode: [placement === 'community_banner' ? 'banner' : 'feed'] },
          requestStartedAt
        )
      )
    })
  )
  const merged = new Map()
  for (const ad of results.flat()) {
    const previous = merged.get(ad.id)
    merged.set(
      ad.id,
      previous ? { ...previous, displayMode: [...previous.displayMode, ...ad.displayMode] } : ad
    )
  }
  return [...merged.values()]
}

// Consulta usada pelo banner rotativo da Home: anúncios globais, sem relação com
// comunidades do usuário.
export async function listGlobalSponsoredAds() {
  const requestStartedAt = performance.now()
  const { data, error } = await supabase.rpc('select_advertising', {
    p_placement: 'home_banner',
    p_context: null,
  })
  if (error) throw error
  return data.map((row) => toDoc(row, requestStartedAt))
}

// Mesmo padrão de listGlobalSponsoredAds, pro banner compacto de /progresso: posicionamento
// independente (progress_banner nunca herda campanhas do home_banner -- ver migration
// 20261216000001_advertising_legacy_delivery_scope_fix.sql).
export async function listProgressSponsoredAds() {
  const requestStartedAt = performance.now()
  const { data, error } = await supabase.rpc('select_advertising', {
    p_placement: 'progress_banner',
    p_context: null,
  })
  if (error) throw error
  return data.map((row) => toDoc(row, requestStartedAt))
}

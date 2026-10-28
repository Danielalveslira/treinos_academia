import { adAuthorizationDeadline } from '../utils/adAuthorization'
import { supabase } from '../supabase/config'

// Um anúncio só aparece nas comunidades listadas em communityIds — NUNCA em todas por
// padrão. A ausência de uma comunidade nessa lista não é um bug a corrigir; é o
// comportamento esperado. RLS (ver migration 20260929000006_sponsored_ads.sql) reforça
// essa mesma filtragem no servidor (não só confia neste arquivo).

const MAX_LIST = 200

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
  }
}

// Uso administrativo: todos os anúncios, ativos ou não, pra tela de gestão.
export async function listAllSponsoredAds() {
  const { data, error } = await supabase
    .from('sponsored_ads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(MAX_LIST)
  if (error) throw error
  return data.map((row) => toDoc(row))
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

function sponsoredAdFields(ad) {
  const hasCta = Boolean(ad.ctaLabel?.trim())
  return {
    partner_name: ad.partnerName.trim(),
    title: ad.title.trim(),
    description: ad.description?.trim() || '',
    image_url: ad.imageUrl?.trim() || null,
    cta_label: hasCta ? ad.ctaLabel.trim() : null,
    cta_type: hasCta ? ad.ctaType : null,
    cta_target: hasCta ? ad.ctaTarget.trim() : null,
    expires_at: ad.expiresAt || null,
    community_ids: ad.communityIds,
    is_global: Boolean(ad.isGlobal),
    display_mode: ad.displayMode,
  }
}

// Os tetos (MAX_ACTIVE_ADS_PER_COMMUNITY/MAX_ACTIVE_GLOBAL_ADS) agora são reforçados por
// trigger no banco (enforce_sponsored_ad_caps) -- diferente do original, isto nunca deixa
// um client furar o teto escrevendo direto. O erro cru é traduzido abaixo pra manter as
// mesmas classes de erro que SponsoredAdForm.jsx já espera (inclusive err.communityId,
// usado pra destacar o seletor certo).
import { SponsoredAdCapError, SponsoredAdGlobalCapError } from '../utils/validators'

function translateCapError(error) {
  if (error?.message === 'GLOBAL_AD_CAP_REACHED') return new SponsoredAdGlobalCapError()
  const match = /^COMMUNITY_AD_CAP_REACHED:(.+)$/.exec(error?.message || '')
  if (match) return new SponsoredAdCapError(match[1])
  return error
}

export async function createSponsoredAd(userId, ad) {
  const { error } = await supabase
    .from('sponsored_ads')
    .insert({ ...sponsoredAdFields(ad), created_by: userId })
  if (error) throw translateCapError(error)
}

export async function updateSponsoredAd(adId, ad) {
  const { error } = await supabase
    .from('sponsored_ads')
    .update(sponsoredAdFields(ad))
    .eq('id', adId)
  if (error) throw translateCapError(error)
}

export async function deleteSponsoredAd(adId) {
  const { error } = await supabase.from('sponsored_ads').delete().eq('id', adId)
  if (error) throw error
}

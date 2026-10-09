import { supabase } from '../supabase/config'

// Um anúncio só aparece nas comunidades listadas em communityIds — NUNCA em todas por
// padrão. A ausência de uma comunidade nessa lista não é um bug a corrigir; é o
// comportamento esperado. RLS (ver migration 20260929000006_sponsored_ads.sql) reforça
// essa mesma filtragem no servidor (não só confia neste arquivo).

const MAX_LIST = 200

function toDoc(row) {
  return {
    id: row.id,
    partnerName: row.partner_name,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    ctaLabel: row.cta_label,
    ctaType: row.cta_type,
    ctaTarget: row.cta_target,
    expiresAt: row.expires_at,
    communityIds: row.community_ids ?? [],
    isGlobal: row.is_global,
    displayMode: row.display_mode,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

// Colunas que as telas públicas realmente renderizam. `select('*')` trazia também community_ids (até 50
// UUIDs por anúncio), created_by e created_at, que nenhum card usa -- bytes à toa em cada leitura. O filtro
// de comunidade/global continua sendo feito (e reforçado pela RLS) no servidor; os campos omitidos voltam
// como undefined em toDoc.
const PUBLIC_COLUMNS =
  'id, partner_name, title, description, image_url, cta_label, cta_type, cta_target, expires_at, is_global, display_mode'

// Campanha vencida nem sai do servidor, e o "agora" é o do PRÓPRIO Postgres: `now` é um valor especial de
// timestamptz avaliado no banco, então um aparelho com a hora errada não ressuscita nem derruba campanhas.
// A lista fica em cache; a revalidação durante esse tempo usa o relógio do servidor (utils/serverClock.js).
// A RLS segue como regra de acesso; tornar a validade parte da policy exigiria migration.
const NOT_EXPIRED_FILTER = 'expires_at.is.null,expires_at.gt.now'

// Uso administrativo: todos os anúncios, ativos ou não, pra tela de gestão.
export async function listAllSponsoredAds() {
  const { data, error } = await supabase
    .from('sponsored_ads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(MAX_LIST)
  if (error) throw error
  return data.map(toDoc)
}

// Consulta usada pelas telas de comunidade (card no feed / banner rotativo). expiresAt e
// displayMode são filtrados no client logo depois deste fetch (ver useSponsoredAds.js).
export async function listSponsoredAdsForCommunity(communityId) {
  const { data, error } = await supabase
    .from('sponsored_ads')
    .select(PUBLIC_COLUMNS)
    .contains('community_ids', [communityId])
    .or(NOT_EXPIRED_FILTER)
  if (error) throw error
  return data.map(toDoc)
}

// Consulta usada pelo banner rotativo da Home: anúncios globais, sem relação com
// comunidades do usuário.
export async function listGlobalSponsoredAds() {
  const { data, error } = await supabase
    .from('sponsored_ads')
    .select(PUBLIC_COLUMNS)
    .eq('is_global', true)
    .or(NOT_EXPIRED_FILTER)
  if (error) throw error
  return data.map(toDoc)
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

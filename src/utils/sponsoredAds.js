import { toMillis } from './expiry.js'
import { hasServerClock, serverNow } from './serverClock.js'

// Composição única dos anúncios de uma comunidade, feita no client sobre a lista que já veio (e foi
// cacheada) da consulta única -- nenhuma consulta por card. A regra de verdade sobre quem pode ver o quê
// continua sendo a RLS de sponsored_ads, e a consulta já vem filtrada pela validade no relógio do servidor;
// aqui só se confere de novo a validade (a lista fica em cache) e se decide ONDE cada campanha aparece.
//
// Campanha nos dois modos (banner + feed) mantém as DUAS exposições contratadas, mas nunca coladas: o card
// do feed dessa campanha não vai para o topo (junto do banner) e sim DEPOIS de algumas publicações
// (interleaveAds). Campanhas só de feed continuam no topo do feed, como antes.
// Instante de referência da revalidação local: o relógio do SERVIDOR, nunca o do aparelho. Sem amostra
// dele devolve null e a revalidação é dispensada (vale o filtro que o servidor já aplicou na consulta).
export function referenceNow() {
  return hasServerClock() ? serverNow() : null
}

export function isAdActive(ad, now = referenceNow()) {
  return now === null || !ad.expiresAt || toMillis(ad.expiresAt) > now
}

export function composeCommunityAds(ads, now = referenceNow()) {
  const active = (ads || []).filter((ad) => isAdActive(ad, now))
  const bannerAds = active.filter((ad) => ad.displayMode.includes('banner'))
  const bannerIds = new Set(bannerAds.map((ad) => ad.id))
  const feedModeAds = active.filter((ad) => ad.displayMode.includes('feed'))
  return {
    bannerAds,
    // só de feed: topo do feed
    feedAds: feedModeAds.filter((ad) => !bannerIds.has(ad.id)),
    // também no banner: entram no meio do feed, longe do banner
    inlineFeedAds: feedModeAds.filter((ad) => bannerIds.has(ad.id)),
  }
}

export function selectBannerAds(ads, now = referenceNow()) {
  return (ads || []).filter((ad) => isAdActive(ad, now) && ad.displayMode.includes('banner'))
}

// Próximo instante (ms, relógio do servidor) em que alguma campanha da lista vence; null se nenhuma vence.
export function nextExpiry(ads, now = referenceNow()) {
  if (now === null) return null
  let next = null
  for (const ad of ads || []) {
    const at = ad.expiresAt ? toMillis(ad.expiresAt) : 0
    if (at > now && (next === null || at < next)) next = at
  }
  return next
}

export const INLINE_AD_FIRST_AFTER = 3
export const INLINE_AD_EVERY = 4

// Intercala campanhas na lista de publicações: a 1ª depois de `firstAfter` itens, as demais a cada `every`.
// Se há menos publicações carregadas que a posição, a campanha vai para o fim da lista (nunca é descartada:
// a exposição contratada se mantém) e acompanha o fim conforme novas páginas chegam. Devolve
// [{ type: 'item', item }, { type: 'ad', ad }] na ordem final.
export function interleaveAds(
  items,
  ads,
  { firstAfter = INLINE_AD_FIRST_AFTER, every = INLINE_AD_EVERY } = {}
) {
  const result = []
  let adIndex = 0
  const positionOf = (index) => Math.min(firstAfter + index * every, items.length)
  const pushDue = (count) => {
    while (adIndex < ads.length && positionOf(adIndex) <= count) {
      result.push({ type: 'ad', ad: ads[adIndex] })
      adIndex += 1
    }
  }
  pushDue(0)
  items.forEach((item, index) => {
    result.push({ type: 'item', item })
    pushDue(index + 1)
  })
  return result
}

// Valores iniciais do formulário de campanha: o banco devolve null em image_url, cta_* e expires_at (colunas
// opcionais), mas os campos controlados do formulário (e `.trim()` nos avisos) exigem string. Só os campos do
// molde `empty` entram, e null/undefined caem no padrão do molde.
export function formValuesFromAd(empty, ad) {
  if (!ad) return empty
  const values = { ...empty }
  for (const key of Object.keys(empty)) {
    if (ad[key] !== null && ad[key] !== undefined) values[key] = ad[key]
  }
  return values
}

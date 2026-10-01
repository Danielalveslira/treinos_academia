import { useCallback } from 'react'
import { listSponsoredAdsForCommunity } from '../services/sponsoredAdsService'
import { toMillis } from '../utils/expiry'
import { useCachedQuery } from './useCachedQuery'

// `enabled` deve ser exatamente a mesma flag de "isMember() confirmado" que já controla
// se o resto da tela da comunidade renderiza (ver CommunityDetail.jsx) -- evita disparar
// a consulta antes de a participação estar confirmada (RLS já filtra linha a linha, mas
// não há motivo pra gastar o round-trip antes da hora).
export function useSponsoredAds(communityId, enabled) {
  const cacheKey = `sponsoredAds:${communityId}`
  const fetchAds = useCallback(() => listSponsoredAdsForCommunity(communityId), [communityId])
  const {
    data: ads = [],
    loading,
    error,
  } = useCachedQuery(cacheKey, fetchAds, {
    enabled: enabled && Boolean(communityId),
    context: 'useSponsoredAds',
  })

  const now = Date.now()
  // expiresAt e displayMode não dão pra filtrar na própria query (ver comentário em
  // sponsoredAdsService.js) -- filtrados aqui, no client, logo após o fetch único.
  const active = ads.filter((ad) => !ad.expiresAt || toMillis(ad.expiresAt) > now)
  const feedAds = active.filter((ad) => ad.displayMode.includes('feed'))
  const bannerAds = active.filter((ad) => ad.displayMode.includes('banner'))

  return { feedAds, bannerAds, loading, error }
}

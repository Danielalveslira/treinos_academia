import { useCallback } from 'react'
import { listGlobalSponsoredAds } from '../services/sponsoredAdsService'
import { toMillis } from '../utils/expiry'
import { useCachedQuery } from './useCachedQuery'

const CACHE_KEY = 'sponsoredAds:global'

// `enabled` só precisa ser "usuário autenticado" (não uma checagem de participação em
// comunidade, como em useSponsoredAds.js): a policy de leitura de um anúncio is_global
// só exige auth.uid() is not null, sem depender de community_members.
export function useGlobalSponsoredAds(enabled) {
  const fetchAds = useCallback(() => listGlobalSponsoredAds(), [])
  const {
    data: ads = [],
    loading,
    error,
  } = useCachedQuery(CACHE_KEY, fetchAds, { enabled, context: 'useGlobalSponsoredAds' })

  const now = Date.now()
  // Mesmo filtro client-side de useSponsoredAds.js (expiresAt/displayMode não dão pra
  // filtrar na própria query) — só o modo "banner" importa aqui: a Home nunca renderiza
  // card de feed, então um anúncio isGlobal com displayMode apenas ['feed'] não deveria
  // aparecer nela.
  const bannerAds = ads.filter(
    (ad) => (!ad.expiresAt || toMillis(ad.expiresAt) > now) && ad.displayMode.includes('banner')
  )

  return { bannerAds, loading, error }
}

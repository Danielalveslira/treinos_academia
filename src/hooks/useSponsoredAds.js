import { useCallback, useEffect, useState } from 'react'
import { listSponsoredAdsForCommunity } from '../services/sponsoredAdsService'
import { describeFirestoreError } from '../utils/firestoreError'
import { toMillis } from '../utils/expiry'
import { getCached, setCached } from '../utils/pageCache'

// `enabled` deve ser exatamente a mesma flag de "isMember() confirmado" que já controla
// se o resto da tela da comunidade renderiza (ver CommunityDetail.jsx) -- nunca chamar
// com enabled=true para uma comunidade que o usuário ainda não confirmou participar. A
// regra de leitura em firestore.rules nega a consulta INTEIRA (não filtra documento a
// documento) quando isso acontece; ver a memória "Firestore list-rule get() gotcha".
export function useSponsoredAds(communityId, enabled) {
  const cacheKey = `sponsoredAds:${communityId}`
  const cached = getCached(cacheKey)
  const [ads, setAds] = useState(cached || [])
  const [loading, setLoading] = useState(enabled && !cached)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listSponsoredAdsForCommunity(communityId)
      setAds(data)
      setCached(cacheKey, data)
    } catch (err) {
      setError(describeFirestoreError(err, 'useSponsoredAds'))
    } finally {
      setLoading(false)
    }
  }, [communityId, cacheKey])

  useEffect(() => {
    if (enabled && !cached) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refresh])

  const now = Date.now()
  // expiresAt e displayMode não dão pra filtrar na própria query (ver comentário em
  // sponsoredAdsService.js) -- filtrados aqui, no client, logo após o fetch único.
  const active = ads.filter((ad) => !ad.expiresAt || toMillis(ad.expiresAt) > now)
  const feedAds = active.filter((ad) => ad.displayMode.includes('feed'))
  const bannerAds = active.filter((ad) => ad.displayMode.includes('banner'))

  return { feedAds, bannerAds, loading, error }
}

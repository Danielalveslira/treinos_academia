import { useCallback, useEffect, useState } from 'react'
import { listGlobalSponsoredAds } from '../services/sponsoredAdsService'
import { describeFirestoreError } from '../utils/firestoreError'
import { toMillis } from '../utils/expiry'
import { getCached, setCached } from '../utils/pageCache'

const CACHE_KEY = 'sponsoredAds:global'

// `enabled` só precisa ser "usuário autenticado" (não uma checagem de participação em
// comunidade, como em useSponsoredAds.js): a regra de leitura de um anúncio isGlobal só
// exige isSignedIn(), sem depender de myCommunityIds() — não há o mesmo risco de a
// consulta inteira ser negada (ver "Firestore list-rule get() gotcha").
export function useGlobalSponsoredAds(enabled) {
  const cached = getCached(CACHE_KEY)
  const [ads, setAds] = useState(cached || [])
  const [loading, setLoading] = useState(enabled && !cached)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listGlobalSponsoredAds()
      setAds(data)
      setCached(CACHE_KEY, data)
    } catch (err) {
      setError(describeFirestoreError(err, 'useGlobalSponsoredAds'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled && !cached) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refresh])

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

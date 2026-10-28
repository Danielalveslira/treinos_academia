import { useCallback, useMemo } from 'react'
import { listGlobalSponsoredAds } from '../services/sponsoredAdsService'
import { selectBannerAds } from '../utils/sponsoredAds'
import { useAdExpiryTick } from './useAdExpiryTick'
import { useAdvertisingSelection } from './useAdvertisingSelection'

const CACHE_KEY = 'sponsoredAds:global'

// Referência estável: um `[]` novo a cada render refaria a composição e o efeito de vencimento à toa.
const NO_ADS = []

// `enabled` só precisa ser "usuário autenticado" (não uma checagem de participação em
// comunidade, como em useSponsoredAds.js): a policy de leitura de um anúncio is_global
// só exige auth.uid() is not null, sem depender de community_members.
export function useGlobalSponsoredAds(enabled) {
  const fetchAds = useCallback(() => listGlobalSponsoredAds(), [])
  const {
    data: ads = NO_ADS,
    loading,
    error,
  } = useAdvertisingSelection(CACHE_KEY, enabled, fetchAds)

  // Só o modo "banner" importa aqui: a Home nunca renderiza card de feed, então um anúncio isGlobal com
  // displayMode apenas ['feed'] não deveria aparecer nela.
  const expiryTick = useAdExpiryTick(ads)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- expiryTick só força a recomposição na hora do vencimento
  const bannerAds = useMemo(() => selectBannerAds(ads), [ads, expiryTick])

  return { bannerAds, loading, error }
}

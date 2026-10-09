import { useCallback, useMemo } from 'react'
import { listSponsoredAdsForCommunity } from '../services/sponsoredAdsService'
import { composeCommunityAds } from '../utils/sponsoredAds'
import { useAdExpiryTick } from './useAdExpiryTick'
import { useCachedQuery } from './useCachedQuery'

// Referência estável: um `[]` novo a cada render refaria a composição e o efeito de vencimento à toa.
const NO_ADS = []

// `enabled` deve ser exatamente a mesma flag de "isMember() confirmado" que já controla
// se o resto da tela da comunidade renderiza (ver CommunityDetail.jsx) -- evita disparar
// a consulta antes de a participação estar confirmada (RLS já filtra linha a linha, mas
// não há motivo pra gastar o round-trip antes da hora).
export function useSponsoredAds(communityId, enabled) {
  const cacheKey = `sponsoredAds:${communityId}`
  const fetchAds = useCallback(() => listSponsoredAdsForCommunity(communityId), [communityId])
  const {
    data: ads = NO_ADS,
    loading,
    error,
  } = useCachedQuery(cacheKey, fetchAds, {
    enabled: enabled && Boolean(communityId),
    context: 'useSponsoredAds',
  })

  // expiresAt e displayMode não dão pra filtrar por completo na query (ver sponsoredAdsService.js) -- a
  // composição (validade, modos e posição banner x feed) roda uma vez por lista carregada.
  const expiryTick = useAdExpiryTick(ads)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- expiryTick só força a recomposição na hora do vencimento
  const composed = useMemo(() => composeCommunityAds(ads), [ads, expiryTick])

  return { ...composed, loading, error }
}

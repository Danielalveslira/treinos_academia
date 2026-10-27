import { useCallback, useEffect, useState } from 'react'
import {
  listAllSponsoredAds,
  createSponsoredAd,
  updateSponsoredAd,
  deleteSponsoredAd,
} from '../services/sponsoredAdsService'
import { describeQueryError } from '../utils/queryError'
import { useAuth } from './useAuth'

export function useAdminSponsoredAds(enabled = true) {
  const { user } = useAuth()
  const [ads, setAds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAds(await listAllSponsoredAds())
    } catch (err) {
      setError(describeQueryError(err, 'useAdminSponsoredAds'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled) refresh()
  }, [refresh, enabled])

  // Recarrega a lista inteira em vez de atualizar localmente: o formulário admin deriva
  // o badge "X/6 anúncios" por comunidade a partir desta mesma lista (ver
  // AdminSponsoredAds.jsx), então precisa refletir o total real logo após salvar.
  async function add(ad) {
    await createSponsoredAd(user.uid, ad)
    await refresh()
  }

  async function edit(adId, ad) {
    await updateSponsoredAd(adId, ad)
    await refresh()
  }

  async function remove(adId) {
    await deleteSponsoredAd(adId)
    setAds((prev) => prev.filter((a) => a.id !== adId))
  }

  return { ads, loading, error, refresh, add, edit, remove }
}

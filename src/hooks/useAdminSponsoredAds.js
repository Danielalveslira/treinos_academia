import { useCallback, useEffect, useState } from 'react'
import {
  listInstitutionalAds,
  saveInstitutionalAd,
  setInstitutionalAdActive,
  deleteInstitutionalAd,
} from '../services/institutionalAdsService'
import { describeQueryError } from '../utils/queryError'

export function useAdminSponsoredAds(enabled = true) {
  const [ads, setAds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAds(await listInstitutionalAds())
    } catch (err) {
      setError(describeQueryError(err, 'useAdminSponsoredAds'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled) refresh()
  }, [refresh, enabled])

  async function add(ad, requestId) {
    await saveInstitutionalAd(null, ad, requestId)
    await refresh()
  }

  async function edit(existing, ad) {
    await saveInstitutionalAd(existing, ad)
    await refresh()
  }

  async function remove(ad) {
    await deleteInstitutionalAd(ad)
    await refresh()
  }

  async function setActive(ad, active) {
    await setInstitutionalAdActive(ad, active)
    await refresh()
  }

  return { ads, loading, error, refresh, add, edit, remove, setActive }
}

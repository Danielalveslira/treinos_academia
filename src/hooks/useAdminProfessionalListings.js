import { useCallback, useEffect, useRef, useState } from 'react'
import {
  adminListProfessionalListings,
  adminReactivateProfessionalListing,
  suspendProfessionalListing,
  unpublishProfessionalListing,
} from '../services/professionalListingsService'
import { describeQueryError } from '../utils/queryError'

export function useAdminProfessionalListings(search = '', lifecycleState = '') {
  const [listings, setListings] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const revision = useRef(0)
  const invalidate = useCallback(() => {
    revision.current++
  }, [])
  const actionLock = useRef(false)
  const refresh = useCallback(async () => {
    const current = ++revision.current
    setLoading(true)
    setError(null)
    try {
      const page = await adminListProfessionalListings({ search, lifecycleState })
      if (current !== revision.current) return
      setListings(page.listings)
      setCursor(page.nextCursor)
    } catch (err) {
      if (current === revision.current)
        setError(describeQueryError(err, 'useAdminProfessionalListings'))
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }, [search, lifecycleState])
  useEffect(() => {
    setLoading(true)
    setListings([])
    setCursor(null)
    const timer = setTimeout(refresh, search ? 350 : 0)
    return () => {
      clearTimeout(timer)
      invalidate()
    }
  }, [refresh, search, invalidate])
  async function loadMore() {
    if (loading || !cursor) return
    const current = revision.current
    setLoading(true)
    try {
      const page = await adminListProfessionalListings({ search, lifecycleState, cursor })
      if (current !== revision.current) return
      setListings((previous) => [
        ...new Map([...previous, ...page.listings].map((item) => [item.id, item])).values(),
      ])
      setCursor(page.nextCursor)
    } catch (err) {
      if (current === revision.current)
        setError(describeQueryError(err, 'adminListProfessionalListings'))
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }
  async function runAction(listingId, action, patch) {
    if (actionLock.current) throw new Error('Aguarde a operação atual.')
    actionLock.current = true
    setBusy(listingId)
    try {
      await action()
      setListings((previous) =>
        previous.map((listing) => (listing.id === listingId ? { ...listing, ...patch } : listing))
      )
    } finally {
      actionLock.current = false
      setBusy(null)
    }
  }
  const suspend = (listingId, reason) =>
    runAction(listingId, () => suspendProfessionalListing(listingId, reason), {
      lifecycleState: 'suspended',
    })
  const reactivate = (listingId) =>
    runAction(listingId, () => adminReactivateProfessionalListing(listingId), {
      lifecycleState: 'draft',
    })
  const unpublish = (listingId) =>
    runAction(listingId, () => unpublishProfessionalListing(listingId), {
      lifecycleState: 'archived',
    })
  return {
    listings,
    loading,
    error,
    busy,
    hasMore: !!cursor,
    loadMore,
    refresh,
    suspend,
    reactivate,
    unpublish,
  }
}

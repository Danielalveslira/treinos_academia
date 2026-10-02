import { useCallback, useEffect, useRef, useState } from 'react'
import { listModerationNotices, listSupportRequestsPage } from '../services/supportService'

export function useSupport(userId, admin = false, state = '', listingId = null) {
  const revision = useRef(0)
  const invalidate = useCallback(() => {
    revision.current++
  }, [])
  const [cursor, setCursor] = useState(null)
  const [requests, setRequests] = useState([])
  const [notices, setNotices] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    if (!userId) return
    const current = ++revision.current
    setLoading(true)
    setError('')
    try {
      const [items, decisions] = await Promise.all([
        listSupportRequestsPage(userId, admin, { state, listingId }),
        admin ? Promise.resolve([]) : listModerationNotices(userId),
      ])
      if (current !== revision.current) return
      setRequests(items.items)
      setCursor(items.nextCursor)
      setNotices(decisions)
    } catch {
      if (current === revision.current)
        setError('Não foi possível carregar o atendimento. Tente novamente.')
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }, [userId, admin, state, listingId])
  useEffect(() => {
    refresh()
    return () => {
      invalidate()
    }
  }, [refresh, invalidate])
  async function loadMore() {
    if (!cursor || loading) return
    const current = revision.current
    setLoading(true)
    try {
      const page = await listSupportRequestsPage(userId, admin, { state, listingId, cursor })
      if (current !== revision.current) return
      setRequests((previous) => [...previous, ...page.items])
      setCursor(page.nextCursor)
    } catch {
      if (current === revision.current) setError('Não foi possível carregar mais pedidos.')
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }
  return { hasMore: !!cursor, loadMore, requests, notices, loading, error, refresh }
}

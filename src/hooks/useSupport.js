import { useCallback, useEffect, useState } from 'react'
import { listModerationNotices, listSupportRequests } from '../services/supportService'

export function useSupport(userId, admin = false) {
  const [requests, setRequests] = useState([])
  const [notices, setNotices] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError('')
    try {
      const [items, decisions] = await Promise.all([
        listSupportRequests(userId, admin),
        admin ? Promise.resolve([]) : listModerationNotices(userId),
      ])
      setRequests(items)
      setNotices(decisions)
    } catch {
      setError('Não foi possível carregar o atendimento. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [userId, admin])
  useEffect(() => {
    refresh()
  }, [refresh])
  return { requests, notices, loading, error, refresh }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { listCashPurchasesForAdminPage, listMyCashPurchasesPage } from '../services/cashPurchaseService'

// Mesmo padrão de useSupport.js: paginação por cursor, uma "revision" pra descartar
// respostas atrasadas de uma consulta anterior (troca de filtro/usuário antes da
// primeira terminar).
export function useCashPurchases(userId, admin = false, status = '') {
  const revision = useRef(0)
  const invalidate = useCallback(() => {
    revision.current++
  }, [])
  const [cursor, setCursor] = useState(null)
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!userId) return
    const current = ++revision.current
    setLoading(true)
    setError('')
    try {
      const page = admin
        ? await listCashPurchasesForAdminPage({ status })
        : await listMyCashPurchasesPage(userId)
      if (current !== revision.current) return
      setPurchases(page.items)
      setCursor(page.nextCursor)
    } catch {
      if (current === revision.current)
        setError('Não foi possível carregar as compras. Tente novamente.')
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }, [userId, admin, status])

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
      const page = admin
        ? await listCashPurchasesForAdminPage({ status, cursor })
        : await listMyCashPurchasesPage(userId, { cursor })
      if (current !== revision.current) return
      setPurchases((previous) => [...previous, ...page.items])
      setCursor(page.nextCursor)
    } catch {
      if (current === revision.current) setError('Não foi possível carregar mais compras.')
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }

  return { hasMore: !!cursor, loadMore, purchases, loading, error, refresh }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'
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
    // Zera antes de buscar (não só depois): troca de usuário/filtro nunca deve deixar a
    // lista antiga (e, junto com ela, um pendingId de outro usuário) visível até a nova
    // consulta responder -- ver o listener de pending logo abaixo.
    setPurchases([])
    setCursor(null)
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

  // Chamado logo após requestCashPurchase confirmar sucesso -- evita esperar um
  // refresh() (nova consulta) só pra o pedido recém-criado aparecer em "Minhas compras".
  // Dedup por id: reentradas do mesmo requestId (idempotência) nunca duplicam a linha.
  function addPurchaseLocally(purchase) {
    setPurchases((prev) => (prev.some((p) => p.id === purchase.id) ? prev : [purchase, ...prev]))
  }

  // Nunca mais que 1 pending por usuário (cashPurchaseLock, ver cash-purchase-service.js
  // no backend) -- por isso um único onSnapshot no documento pending atual é suficiente
  // pra saber quando o admin confirma/cancela, sem ouvir a coleção inteira nem fazer
  // polling. Fica sem listener nenhum sempre que não há pending (inclusive admin=true,
  // que já tem sua própria tela com refresh() próprio -- ver AdminCashPurchases.jsx).
  const pendingId = !admin ? purchases.find((p) => p.status === 'pending')?.id ?? null : null
  useEffect(() => {
    if (!pendingId) return undefined
    const unsubscribe = onSnapshot(
      doc(db, 'cashPurchases', pendingId),
      (snapshot) => {
        if (!snapshot.exists()) return
        const data = snapshot.data()
        // Estado inicial do próprio listener (ainda pending) -- nunca reescreve nada, só
        // reage à transição real pra um estado terminal.
        if (data.status === 'pending') return
        setPurchases((prev) => prev.map((p) => (p.id === pendingId ? { ...data, id: pendingId } : p)))
      },
      (err) => console.error('[useCashPurchases] onSnapshot pending:', err)
    )
    return unsubscribe
  }, [pendingId])

  return { hasMore: !!cursor, loadMore, purchases, loading, error, refresh, addPurchaseLocally }
}

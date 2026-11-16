import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase/config'
import {
  getMyPendingCashPurchase,
  listCashPurchasesForAdminPage,
  listMyCashPurchasesPage,
  mapPurchaseRow,
} from '../services/cashPurchaseService'

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
  const [pendingPurchase, setPendingPurchase] = useState(null)
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
      const pending = admin
        ? null
        : page.items.find((purchase) => purchase.status === 'pending') ||
          (await getMyPendingCashPurchase(userId))
      if (current !== revision.current) return
      setPurchases(page.items)
      setPendingPurchase(pending)
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
    setPendingPurchase(null)
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
      setPurchases((previous) => {
        const seen = new Set(previous.map((purchase) => purchase.id))
        return [...previous, ...page.items.filter((purchase) => !seen.has(purchase.id))]
      })
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

  // Nunca mais que 1 pending por usuário (índice único parcial, ver migration
  // economy_cash_purchases_promotions.sql) -- um canal Realtime filtrado por essa linha
  // acompanha checkout, cancelamento e confirmação sem polling.
  // Fica sem listener nenhum sempre que não há pending (inclusive admin=true, que já tem
  // sua própria tela com refresh() próprio -- ver AdminCashPurchases.jsx).
  const pendingId = !admin ? (pendingPurchase?.id ?? null) : null
  useEffect(() => {
    if (!pendingId) return undefined
    const channel = supabase
      .channel(`cash-purchase-${pendingId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'cash_purchases',
          filter: `id=eq.${pendingId}`,
        },
        (payload) => {
          // Atualiza checkout_url e status em outros dispositivos.
          const updated = mapPurchaseRow(payload.new)
          setPendingPurchase(updated.status === 'pending' ? updated : null)
          setPurchases((prev) => prev.map((p) => (p.id === pendingId ? updated : p)))
        }
      )
      .subscribe()
    return () => channel.unsubscribe()
  }, [pendingId])

  return {
    hasMore: !!cursor,
    loadMore,
    purchases,
    pendingPurchase,
    loading,
    error,
    refresh,
    addPurchaseLocally,
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase/config'
import { mergeCashPurchases } from '../utils/cashPurchaseFlow'
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
  const realtimeRevision = useRef(0)
  const realtimeRows = useRef(new Map())
  const currentUserId = useRef(userId)
  currentUserId.current = userId
  const invalidate = useCallback(() => {
    revision.current++
  }, [])
  const [cursor, setCursor] = useState(null)
  const [purchases, setPurchases] = useState([])
  const [pendingPurchase, setPendingPurchase] = useState(null)
  const [lastRealtimeCredit, setLastRealtimeCredit] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!userId) return { ok: false }
    const current = ++revision.current
    const eventVersion = realtimeRevision.current
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
      if (current !== revision.current || currentUserId.current !== userId) return { ok: false }
      const updates = realtimeRows.current
      const changedDuringQuery = realtimeRevision.current !== eventVersion
      const pageIds = new Set(page.items.map((purchase) => purchase.id))
      const latestPage = page.items.map((purchase) =>
        changedDuringQuery ? updates.get(purchase.id) || purchase : purchase
      )
      if (!changedDuringQuery) {
        for (const id of pageIds) updates.delete(id)
      }
      const extraRows = [...updates.values()].filter((purchase) => !pageIds.has(purchase.id))
      const items = mergeCashPurchases(latestPage, extraRows)
      const pendingFromRows = items.find((purchase) => purchase.status === 'pending')
      const updatedPending = pending && updates.get(pending.id)
      const currentPending =
        pendingFromRows ||
        (updatedPending ? (updatedPending.status === 'pending' ? updatedPending : null) : pending)
      setPurchases(items)
      setPendingPurchase(currentPending)
      setCursor(page.nextCursor)
      return { ok: true, pendingPurchase: currentPending }
    } catch {
      if (current === revision.current)
        setError('Não foi possível carregar as compras. Tente novamente.')
      return { ok: false }
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
    setLastRealtimeCredit(null)
    realtimeRows.current.clear()
    setCursor(null)
    refresh()
    return () => {
      invalidate()
    }
  }, [refresh, invalidate])

  async function loadMore() {
    if (!cursor || loading) return
    const current = revision.current
    const eventVersion = realtimeRevision.current
    setLoading(true)
    try {
      const page = admin
        ? await listCashPurchasesForAdminPage({ status, cursor })
        : await listMyCashPurchasesPage(userId, { cursor })
      if (current !== revision.current) return
      const changedDuringQuery = realtimeRevision.current !== eventVersion
      const latestPage = page.items.map((purchase) =>
        changedDuringQuery ? realtimeRows.current.get(purchase.id) || purchase : purchase
      )
      if (!changedDuringQuery) {
        for (const purchase of page.items) realtimeRows.current.delete(purchase.id)
      }
      setPurchases((previous) => mergeCashPurchases(previous, latestPage))
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
    setPurchases((prev) => mergeCashPurchases(prev, [purchase]))
    if (purchase.status === 'pending') setPendingPurchase(purchase)
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
          if (currentUserId.current !== userId || updated.userId !== userId) return
          realtimeRevision.current++
          realtimeRows.current.set(updated.id, updated)
          setPendingPurchase(updated.status === 'pending' ? updated : null)
          setPurchases((prev) => mergeCashPurchases(prev, [updated]))
          if (updated.status === 'credited')
            setLastRealtimeCredit({ userId, purchaseId: updated.id })
        }
      )
      .subscribe()
    return () => channel.unsubscribe()
  }, [pendingId, userId])

  return {
    hasMore: !!cursor,
    loadMore,
    purchases,
    pendingPurchase,
    lastRealtimeCredit,
    loading,
    error,
    refresh,
    addPurchaseLocally,
  }
}

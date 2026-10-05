import { useCallback, useEffect, useRef, useState } from 'react'
import {
  NOTIFICATION_PAGE_SIZE,
  archiveAllNotifications,
  countUnreadNotifications,
  getNotificationById,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  subscribeToNotifications,
} from '../api/notifications.api'
import {
  insertNotification,
  mergeNotificationPage,
  newestCreatedAt,
  notificationCursor,
} from '../utils/notifications'

const COUNT_REFRESH_MIN_MS = 30000
// Depois de um evento Realtime o badge já mudou na hora (otimista); uma releitura do contador,
// agrupada neste intervalo, garante a convergência com o servidor sem polling contínuo.
const COUNT_RECONCILE_MS = 800
const emptyList = { items: [], hasMore: true, loaded: false, loading: false, error: false }

// Estado da central de notificações: contagem do badge (1 RPC leve), duas listas paginadas por
// cursor (Todas / Não lidas) carregadas só quando o popover abre, e as ações em lote. Com `userId`,
// novas notificações, leituras e arquivamentos chegam por Supabase Realtime (INSERT/UPDATE de
// `notifications` do próprio usuário): badge e listas abertas mudam sem recarregar.
export function useNotificationCenter({ enabled = true, userId = null } = {}) {
  const [unread, setUnread] = useState(0)
  const [filter, setFilter] = useState('all')
  const [lists, setLists] = useState({ all: emptyList, unread: emptyList })
  const listsRef = useRef(lists)
  const inflight = useRef({ all: false, unread: false })
  const revision = useRef(0)
  const lastCountAt = useRef(0)
  const seenIds = useRef(new Set())
  const reconcileTimer = useRef(null)
  const lastUserId = useRef(null)
  // Ids cuja leitura/arquivamento JÁ foi aplicada ao badge: eventos repetidos ou em lote (vários
  // no mesmo tick, sem render entre eles) não podem decrementar duas vezes.
  const settledIds = useRef(new Set())
  listsRef.current = lists

  const refreshCount = useCallback(async () => {
    lastCountAt.current = Date.now()
    try {
      setUnread(await countUnreadNotifications())
    } catch {
      // O badge é secundário: se falhar, mantém o valor anterior.
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    refreshCount()
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastCountAt.current < COUNT_REFRESH_MIN_MS) return
      refreshCount()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled, refreshCount])

  const load = useCallback(async (name, { reset = false } = {}) => {
    if (inflight.current[name]) return
    inflight.current[name] = true
    const currentRevision = revision.current
    setLists((current) => ({
      ...current,
      [name]: { ...current[name], loading: true, error: false },
    }))
    try {
      const base = reset ? [] : listsRef.current[name].items
      const cursor = base.length ? notificationCursor(base[base.length - 1]) : null
      const page = await listNotifications({
        cursor,
        unreadOnly: name === 'unread',
        limit: NOTIFICATION_PAGE_SIZE,
      })
      if (currentRevision !== revision.current) return
      page.forEach((item) => seenIds.current.add(item.id))
      setLists((current) => ({
        ...current,
        [name]: {
          items: mergeNotificationPage(base, page),
          hasMore: page.length === NOTIFICATION_PAGE_SIZE,
          loaded: true,
          loading: false,
          error: false,
        },
      }))
    } catch {
      if (currentRevision === revision.current) {
        setLists((current) => ({
          ...current,
          [name]: { ...current[name], loading: false, error: true },
        }))
      }
    } finally {
      inflight.current[name] = false
    }
  }, [])


  const scheduleCountReconcile = useCallback(() => {
    clearTimeout(reconcileTimer.current)
    reconcileTimer.current = setTimeout(() => {
      reconcileTimer.current = null
      refreshCount()
    }, COUNT_RECONCILE_MS)
  }, [refreshCount])

  const findLocal = useCallback((id) => {
    const { all, unread: unreadList } = listsRef.current
    return all.items.find((item) => item.id === id) || unreadList.items.find((item) => item.id === id) || null
  }, [])

  // Realtime: INSERT. Badge na hora; a linha crua do evento é enriquecida (autor, comunidade) pela
  // mesma view da lista e entra no topo das listas JÁ carregadas, sem duplicar pelo id.
  const handleInsert = useCallback(
    async (row, generation) => {
      if (!row || seenIds.current.has(row.id)) return
      seenIds.current.add(row.id)
      if (row.archived_at) return
      if (!row.read_at) setUnread((count) => count + 1)
      scheduleCountReconcile()
      let item = null
      try {
        item = await getNotificationById(row.id)
      } catch {
        return // o contador já foi atualizado; a lista aparece na próxima abertura
      }
      if (!item || generation !== revision.current) return
      setLists((current) => ({
        all: current.all.loaded
          ? { ...current.all, items: insertNotification(current.all.items, item) }
          : current.all,
        unread: current.unread.loaded && !item.readAt
          ? { ...current.unread, items: insertNotification(current.unread.items, item) }
          : current.unread,
      }))
    },
    [scheduleCountReconcile]
  )

  // Realtime: UPDATE (lida / arquivada / voltou a não lida). Só mexe no contador quando a
  // transição é visível no estado local (o próprio usuário já aplicou a ação de forma otimista).
  const handleUpdate = useCallback(
    (row, generation) => {
      if (!row) return
      const local = findLocal(row.id)
      const alreadySettled = settledIds.current.has(row.id)
      if (row.archived_at) {
        settledIds.current.add(row.id)
        if (local && !local.readAt && !alreadySettled) setUnread((count) => Math.max(0, count - 1))
        setLists((current) => ({
          all: { ...current.all, items: current.all.items.filter((item) => item.id !== row.id) },
          unread: { ...current.unread, items: current.unread.items.filter((item) => item.id !== row.id) },
        }))
      } else if (row.read_at) {
        const wasUnread = local && !local.readAt && !alreadySettled
        settledIds.current.add(row.id)
        if (wasUnread) {
          setUnread((count) => Math.max(0, count - 1))
          setLists((current) => ({
            all: {
              ...current.all,
              items: current.all.items.map((item) => (item.id === row.id ? { ...item, readAt: row.read_at } : item)),
            },
            unread: { ...current.unread, items: current.unread.items.filter((item) => item.id !== row.id) },
          }))
        }
      } else if (local && (local.readAt || alreadySettled)) {
        // Voltou a não lida (ex.: curtida recriada): reabre no estado local.
        settledIds.current.delete(row.id)
        setUnread((count) => count + 1)
        const reopened = { ...local, readAt: null }
        setLists((current) => ({
          all: { ...current.all, items: current.all.items.map((item) => (item.id === row.id ? reopened : item)) },
          unread: current.unread.loaded
            ? { ...current.unread, items: insertNotification(current.unread.items, reopened) }
            : current.unread,
        }))
      } else if (!local && !seenIds.current.has(row.id)) {
        handleInsert(row, generation)
      }
      scheduleCountReconcile()
    },
    [findLocal, handleInsert, scheduleCountReconcile]
  )

  // Um canal por usuário logado. Logout, troca de conta e desmontagem removem o canal; o estado
  // da conta anterior é descartado (revision invalida respostas em voo) para não vazar entre contas.
  useEffect(() => {
    if (!enabled || !userId) return undefined
    revision.current += 1
    const generation = revision.current
    seenIds.current = new Set()
    settledIds.current = new Set()
    inflight.current = { all: false, unread: false }
    setLists({ all: emptyList, unread: emptyList })
    setUnread(0)
    // Troca de conta: o contador da conta anterior não vale; a 1ª leitura (montagem) é do efeito acima.
    if (lastUserId.current && lastUserId.current !== userId) refreshCount()
    lastUserId.current = userId
    const unsubscribe = subscribeToNotifications(userId, {
      onInsert: (row) => handleInsert(row, generation),
      onUpdate: (row) => handleUpdate(row, generation),
      onReconnect: () => {
        refreshCount()
        ;['all', 'unread'].forEach((name) => {
          if (listsRef.current[name].loaded) load(name, { reset: true })
        })
      },
    })
    return () => {
      revision.current += 1
      unsubscribe()
      clearTimeout(reconcileTimer.current)
      reconcileTimer.current = null
    }
  }, [enabled, userId, refreshCount, handleInsert, handleUpdate, load])

  // Chamado ao abrir o popover: recarrega a primeira página (mantendo a lista atual até a
  // resposta chegar, sem piscar) e confirma a contagem.
  const refresh = useCallback(
    (name = filter) => {
      load(name, { reset: true })
      refreshCount()
    },
    [filter, load, refreshCount]
  )

  const changeFilter = useCallback(
    (name) => {
      setFilter(name)
      if (!listsRef.current[name].loaded) load(name, { reset: true })
    },
    [load]
  )

  const loadMore = useCallback(() => load(filter), [filter, load])

  const markRead = useCallback(async (notification) => {
    if (notification.readAt) return
    const readAt = new Date().toISOString()
    const mark = (item) => (item.id === notification.id ? { ...item, readAt } : item)
    setLists((current) => ({
      all: { ...current.all, items: current.all.items.map(mark) },
      unread: { ...current.unread, items: current.unread.items.map(mark) },
    }))
    setUnread((count) => Math.max(0, count - 1))
    try {
      await markNotificationsRead([notification.id])
    } catch {
      const revert = (item) => (item.id === notification.id ? notification : item)
      setLists((current) => ({
        all: { ...current.all, items: current.all.items.map(revert) },
        unread: { ...current.unread, items: current.unread.items.map(revert) },
      }))
      setUnread((count) => count + 1)
    }
  }, [])

  const resetAfterBulk = useCallback(
    async (action, optimistic) => {
      const before = newestCreatedAt(listsRef.current.all.items, listsRef.current.unread.items)
      if (!before) return true
      revision.current += 1
      inflight.current = { all: false, unread: false }
      setLists(optimistic)
      setUnread(0)
      try {
        await action(before)
        // Pode haver notificações mais novas que a lista exibida.
        await refreshCount()
        return true
      } catch {
        revision.current += 1
        setLists({ all: emptyList, unread: emptyList })
        load(filter, { reset: true })
        refreshCount()
        return false
      }
    },
    [filter, load, refreshCount]
  )

  const markAllRead = useCallback(() => {
    const readAt = new Date().toISOString()
    return resetAfterBulk(markAllNotificationsRead, (current) => ({
      all: {
        ...current.all,
        items: current.all.items.map((item) => (item.readAt ? item : { ...item, readAt })),
      },
      unread: { items: [], hasMore: false, loaded: true, loading: false, error: false },
    }))
  }, [resetAfterBulk])

  const clearAll = useCallback(
    () =>
      resetAfterBulk(archiveAllNotifications, () => ({
        all: { items: [], hasMore: false, loaded: true, loading: false, error: false },
        unread: { items: [], hasMore: false, loaded: true, loading: false, error: false },
      })),
    [resetAfterBulk]
  )

  return {
    unread,
    filter,
    list: lists[filter],
    changeFilter,
    refresh,
    loadMore,
    markRead,
    markAllRead,
    clearAll,
  }
}

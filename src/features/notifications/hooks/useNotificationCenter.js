import { useCallback, useEffect, useRef, useState } from 'react'
import {
  NOTIFICATION_PAGE_SIZE,
  archiveAllNotifications,
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from '../api/notifications.api'
import { mergeNotificationPage, newestCreatedAt, notificationCursor } from '../utils/notifications'

const COUNT_REFRESH_MIN_MS = 30000
const emptyList = { items: [], hasMore: true, loaded: false, loading: false, error: false }

// Estado da central de notificações: contagem do badge (1 RPC leve), duas listas paginadas por
// cursor (Todas / Não lidas) carregadas só quando o popover abre, e as ações em lote.
export function useNotificationCenter({ enabled = true } = {}) {
  const [unread, setUnread] = useState(0)
  const [filter, setFilter] = useState('all')
  const [lists, setLists] = useState({ all: emptyList, unread: emptyList })
  const listsRef = useRef(lists)
  const inflight = useRef({ all: false, unread: false })
  const revision = useRef(0)
  const lastCountAt = useRef(0)
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

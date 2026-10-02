import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellIcon } from '@primer/octicons-react'
import { Spinner, Text } from '@primer/react'
import {
  countUnreadCommentNotifications,
  listCommentNotifications,
  markCommentNotificationRead,
} from '../api/notifications.api'
import { formatDateTime } from '../../../utils/format'
import { toDate } from '../../../utils/date'

function notificationLabel(notification) {
  const actor = notification.actorUsername ? `@${notification.actorUsername}` : 'Alguém'
  if (notification.type === 'comment_like') return `${actor} curtiu seu comentário.`
  if (notification.type === 'comment_reply') return `${actor} respondeu seu comentário.`
  return `${actor} comentou na sua publicação.`
}

export function CommentNotifications() {
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    countUnreadCommentNotifications()
      .then((count) => active && setUnread(count))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  async function load() {
    if (items || loading) return
    setLoading(true)
    setError('')
    try {
      setItems(await listCommentNotifications())
    } catch {
      setError('Não foi possível carregar as notificações.')
    } finally {
      setLoading(false)
    }
  }

  async function markRead(notification) {
    if (notification.readAt) return
    setItems((current) =>
      current?.map((item) =>
        item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item
      )
    )
    setUnread((count) => Math.max(0, count - 1))
    try {
      await markCommentNotificationRead(notification.id)
    } catch {
      setItems((current) =>
        current?.map((item) => (item.id === notification.id ? notification : item))
      )
      setUnread((count) => count + 1)
    }
  }

  return (
    <details
      className="comment-notifications"
      onToggle={(event) => event.currentTarget.open && load()}
    >
      <summary aria-label={`Notificações${unread ? `, ${unread} não lidas` : ''}`}>
        <BellIcon size={18} />
        {unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
      </summary>
      <div className="notification-popover">
        <Text as="h2">Notificações</Text>
        {loading && <Spinner size="small" />}
        {error && <Text className="comment-error">{error}</Text>}
        {items?.length === 0 && <Text className="notification-empty">Nenhuma notificação.</Text>}
        {items?.map((notification) => (
          <Link
            key={notification.id}
            className={`notification-item${notification.readAt ? '' : ' is-unread'}`}
            to={`/comunidades/${notification.communityId}/publicacoes/${notification.statusId}/comentarios/${notification.commentId}`}
            onClick={() => markRead(notification)}
          >
            <span>{notificationLabel(notification)}</span>
            <time dateTime={notification.createdAt}>
              {formatDateTime(toDate(notification.createdAt))}
            </time>
          </Link>
        ))}
      </div>
    </details>
  )
}

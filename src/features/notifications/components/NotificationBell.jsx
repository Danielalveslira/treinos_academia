import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  AlertIcon,
  BellIcon,
  CheckIcon,
  CheckCircleIcon,
  ClockIcon,
  CommentIcon,
  CreditCardIcon,
  MegaphoneIcon,
  ShieldIcon,
  ThumbsupIcon,
  TrashIcon,
  ZapIcon,
} from '@primer/octicons-react'
import { Button, IconButton, SegmentedControl, Spinner, Text } from '@primer/react'
import { formatDateTime } from '../../../utils/format'
import { toDate } from '../../../utils/date'
import { useNotificationCenter } from '../hooks/useNotificationCenter'
import {
  formatRelativeNotificationTime,
  isAdminNotification,
  notificationContent,
  notificationHref,
} from '../utils/notifications'

const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'unread', label: 'Não lidas' },
]

function NotificationIcon({ notification }) {
  if (notification.entityType === 'refund_request') return <CreditCardIcon size={16} />
  switch (notification.type) {
    case 'workout_reminder_before':
    case 'workout_reminder_start':
      return <ClockIcon size={16} />
    case 'admin_broadcast':
      return <MegaphoneIcon size={16} />
    case 'post_like':
    case 'comment_like':
      return <ThumbsupIcon size={16} />
    case 'economy_credit':
    case 'economy_debit':
      return <ZapIcon size={16} />
    case 'moderation_notice':
      return notification.priority === 'high' ? <AlertIcon size={16} /> : <ShieldIcon size={16} />
    case 'report_resolved':
      return <CheckCircleIcon size={16} />
    default:
  }
  if (!isAdminNotification(notification)) return <CommentIcon size={16} />
  return notification.priority === 'high' ? <AlertIcon size={16} /> : <ShieldIcon size={16} />
}

export function NotificationItem({ notification, onSelect }) {
  const { title, description } = notificationContent(notification)
  const href = notificationHref(notification)
  const unread = !notification.readAt
  const className = `notification-item${unread ? ' is-unread' : ''}${
    notification.priority === 'high' ? ' is-priority' : ''
  }`
  const body = (
    <>
      <span className="notification-icon" aria-hidden="true">
        <NotificationIcon notification={notification} />
      </span>
      <span className="notification-text">
        <span className="notification-title" title={title}>
          {unread && <span className="sr-only">Não lida: </span>}
          {title}
        </span>
        {description && (
          <span className="notification-description" title={description}>
            {description}
          </span>
        )}
        <time dateTime={notification.createdAt} title={formatDateTime(toDate(notification.createdAt))}>
          {formatRelativeNotificationTime(notification.createdAt)}
        </time>
      </span>
      {unread && <span className="notification-dot" aria-hidden="true" />}
    </>
  )
  if (!href) {
    return (
      <button type="button" className={className} onClick={() => onSelect(notification, null)}>
        {body}
      </button>
    )
  }
  return (
    <Link to={href} className={className} onClick={() => onSelect(notification, href)}>
      {body}
    </Link>
  )
}

export function NotificationBell({ userId = null } = {}) {
  const center = useNotificationCenter({ userId })
  const { unread, filter, list, changeFilter, loadMore, markAllRead, clearAll, markRead } = center
  const [open, setOpen] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const popoverRef = useRef(null)
  const popoverId = useId()
  const { key: locationKey } = useLocation()

  // Dialog não modal: ao abrir, o foco entra no painel (ARIA APG); Esc devolve ao sino.
  useEffect(() => {
    if (open) popoverRef.current?.focus()
  }, [open])

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    setConfirmingClear(false)
    if (restoreFocus) buttonRef.current?.focus()
  }, [])

  // Navegar para outra tela fecha.
  useEffect(() => {
    close()
  }, [locationKey, close])

  // Clique/foco fora e Esc fecham; interações dentro do popover não. Abrir outro menu implica
  // clicar/focar fora do sino, então ele também fecha.
  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) close()
    }
    function onFocusIn(event) {
      if (!rootRef.current?.contains(event.target)) close()
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') close(true)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  function toggle() {
    if (open) {
      close()
      return
    }
    setOpen(true)
    center.refresh()
  }

  function select(notification) {
    markRead(notification)
    close()
  }

  async function confirmClear() {
    setConfirmingClear(false)
    await clearAll()
  }

  const hasItems = list.items.length > 0
  const showInitialLoading = list.loading && !hasItems
  const showEmpty = list.loaded && !list.loading && !list.error && !hasItems

  return (
    <div className="notification-bell" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="notification-trigger"
        aria-label={`Notificações${unread ? `, ${unread > 99 ? 'mais de 99' : unread} não lidas` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={toggle}
      >
        <BellIcon size={18} />
        {unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div
          className="notification-popover"
          id={popoverId}
          role="dialog"
          aria-label="Notificações"
          ref={popoverRef}
          tabIndex={-1}
        >
          <div className="notification-header">
            <Text as="h2">Notificações</Text>
            <div className="notification-header-actions">
              <IconButton
                icon={CheckIcon}
                size="small"
                variant="invisible"
                aria-label="Marcar todas como lidas"
                disabled={unread === 0}
                onClick={markAllRead}
              />
              <IconButton
                icon={TrashIcon}
                size="small"
                variant="invisible"
                aria-label="Limpar notificações"
                disabled={!hasItems}
                onClick={() => setConfirmingClear(true)}
              />
            </div>
          </div>

          {confirmingClear && (
            <div
              className="notification-confirm"
              role="alertdialog"
              aria-label="Limpar notificações"
            >
              <Text>Ocultar todas as notificações? Os eventos originais não são apagados.</Text>
              <div className="comment-inline-actions">
                <Button size="small" variant="invisible" onClick={() => setConfirmingClear(false)}>
                  Cancelar
                </Button>
                <Button size="small" variant="danger" onClick={confirmClear}>
                  Limpar
                </Button>
              </div>
            </div>
          )}

          <div className="notification-filter">
            <SegmentedControl
              aria-label="Filtrar notificações"
              size="small"
              onChange={(index) => changeFilter(FILTERS[index].id)}
            >
              {FILTERS.map((item) => (
                <SegmentedControl.Button key={item.id} selected={filter === item.id}>
                  {item.label}
                </SegmentedControl.Button>
              ))}
            </SegmentedControl>
          </div>

          <div className="notification-list">
            {showInitialLoading && (
              <div
                className="notification-loading"
                role="status"
                aria-label="Carregando notificações"
              >
                <span />
                <span />
                <span />
              </div>
            )}
            {list.error && (
              <div className="comment-state is-error" role="alert">
                <Text>Não foi possível carregar as notificações.</Text>
                <Button size="small" variant="invisible" onClick={loadMore}>
                  Tentar novamente
                </Button>
              </div>
            )}
            {showEmpty && (
              <div className="notification-empty">
                <BellIcon size={24} />
                <Text>
                  {filter === 'unread'
                    ? 'Você não tem notificações não lidas.'
                    : 'Nenhuma notificação.'}
                </Text>
              </div>
            )}
            {list.items.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onSelect={select}
              />
            ))}
            {list.hasMore && hasItems && !list.error && (
              <div className="notification-more">
                <Button size="small" variant="invisible" disabled={list.loading} onClick={loadMore}>
                  {list.loading ? (
                    <>
                      <Spinner size="small" /> Carregando…
                    </>
                  ) : (
                    'Ver mais'
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

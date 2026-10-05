const ACTION_LABELS = {
  warning: 'Advertência',
  remove_content: 'Conteúdo removido',
  suspend_listing: 'Vitrine suspensa',
  temporary_suspension: 'Suspensão temporária',
  community_ban: 'Banimento da comunidade',
  system_ban: 'Banimento do sistema',
  restore: 'Restrição revertida',
}

const TARGET_LABELS = {
  comment: 'Comentário denunciado',
  publication: 'Publicação denunciada',
  listing: 'Vitrine denunciada',
}

export const ADMIN_NOTIFICATION_TYPES = new Set([
  'admin_report',
  'admin_appeal',
  'admin_privacy_request',
  'admin_moderation_decision',
  'admin_restriction',
  'admin_deletion_review',
  'admin_broadcast',
])

export function isAdminNotification(notification) {
  return ADMIN_NOTIFICATION_TYPES.has(notification.type)
}

function actorName(notification) {
  return notification.actorUsername ? `@${notification.actorUsername}` : 'Alguém'
}

// Texto sempre montado a partir de tipo + metadados mínimos; nenhum conteúdo de denúncia é exibido.
export function notificationContent(notification) {
  const metadata = notification.metadata || {}
  switch (notification.type) {
    case 'comment_like':
      return { title: `${actorName(notification)} curtiu seu comentário.` }
    case 'comment_reply':
      return { title: `${actorName(notification)} respondeu seu comentário.` }
    case 'comment_mention':
      return { title: `${actorName(notification)} mencionou você em um comentário.` }
    case 'post_reply':
      return { title: `${actorName(notification)} comentou na sua publicação.` }
    case 'admin_report':
      return {
        title: 'Nova denúncia aguardando análise',
        description: TARGET_LABELS[metadata.target],
      }
    case 'admin_appeal':
      return { title: 'Novo recurso aguardando análise' }
    case 'admin_privacy_request':
      return { title: 'Nova solicitação de privacidade' }
    case 'admin_moderation_decision':
      return {
        title: 'Decisão de moderação registrada',
        description: ACTION_LABELS[metadata.action],
      }
    case 'admin_restriction':
      return { title: 'Restrição aplicada', description: ACTION_LABELS[metadata.action] }
    case 'admin_deletion_review':
      return { title: 'Exclusão de conta aguardando revisão financeira' }
    case 'admin_broadcast':
      return {
        title: typeof metadata.title === 'string' ? metadata.title : 'Aviso do Evolutus',
        description: typeof metadata.body === 'string' ? metadata.body : undefined,
      }
    default:
      return { title: 'Nova notificação' }
  }
}

// Só aceita caminhos internos (começam com "/", nem "//" nem "/\"): o destino vem do banco, mas o
// cliente nunca navega para uma URL externa a partir de uma notificação.
export function safeActionUrl(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')
    ? url
    : null
}

export function notificationHref(notification) {
  if (notification.commentId && notification.statusId && notification.communityId) {
    return `/comunidades/${notification.communityId}/publicacoes/${notification.statusId}/comentarios/${notification.commentId}`
  }
  return safeActionUrl(notification.actionUrl)
}

// Insere uma notificação recebida em tempo real na ordem da lista (created_at desc, id desc),
// sem duplicar pelo id. Devolve a MESMA lista quando já existe (evita render à toa).
export function insertNotification(items, notification) {
  if (items.some((item) => item.id === notification.id)) return items
  const index = items.findIndex(
    (item) =>
      item.createdAt < notification.createdAt ||
      (item.createdAt === notification.createdAt && item.id < notification.id)
  )
  if (index === -1) return [...items, notification]
  return [...items.slice(0, index), notification, ...items.slice(index)]
}

export function notificationCursor(notification) {
  return { createdAt: notification.createdAt, id: notification.id }
}

export function mergeNotificationPage(current, page) {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...page.filter((item) => !seen.has(item.id))]
}

// Limite superior seguro para "marcar todas"/"limpar": a notificação mais recente já exibida.
// Tudo que chegou depois de a lista ser carregada fica de fora e continua não lido.
export function newestCreatedAt(...lists) {
  let newest = null
  for (const list of lists) {
    for (const item of list || []) {
      if (!newest || item.createdAt > newest) newest = item.createdAt
    }
  }
  return newest
}

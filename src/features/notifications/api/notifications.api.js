export const NOTIFICATION_PAGE_SIZE = 12

const NOTIFICATION_COLUMNS =
  'id,actor_id,actor_username,type,priority,status_id,comment_id,community_id,entity_type,entity_id,action_url,metadata,read_at,created_at'

async function getSupabase() {
  return (await import('../../../supabase/config')).supabase
}

export function mapNotificationRow(row) {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    type: row.type,
    priority: row.priority || 'normal',
    statusId: row.status_id,
    commentId: row.comment_id,
    communityId: row.community_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actionUrl: row.action_url,
    metadata: row.metadata || {},
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

// Badge: RPC com teto no servidor (índice parcial das não lidas) -- nunca baixa a lista.
export async function countUnreadNotifications() {
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('notifications_unread_count')
  if (error) throw error
  return data || 0
}

// Paginação por cursor (created_at, id) sobre notification_items, que já exclui as arquivadas.
export async function listNotifications({
  cursor = null,
  unreadOnly = false,
  limit = NOTIFICATION_PAGE_SIZE,
} = {}) {
  const supabase = await getSupabase()
  let query = supabase
    .from('notification_items')
    .select(NOTIFICATION_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 20))
  if (unreadOnly) query = query.is('read_at', null)
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    )
  }
  const { data, error } = await query
  if (error) throw error
  return data.map(mapNotificationRow)
}

export async function markNotificationsRead(ids) {
  const supabase = await getSupabase()
  const { error } = await supabase.rpc('notifications_mark_read', { p_ids: ids, p_before: null })
  if (error) throw error
}

// "Marcar todas como lidas": tudo até a notificação mais recente que o usuário viu.
export async function markAllNotificationsRead(before) {
  const supabase = await getSupabase()
  const { error } = await supabase.rpc('notifications_mark_read', {
    p_ids: null,
    p_before: before,
  })
  if (error) throw error
}

// "Limpar": arquiva (oculta) -- não apaga o evento original nem denúncias/moderação.
export async function archiveAllNotifications(before) {
  const supabase = await getSupabase()
  const { error } = await supabase.rpc('notifications_archive', { p_ids: null, p_before: before })
  if (error) throw error
}

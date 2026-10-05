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

// Uma notificação já enriquecida (autor, comunidade) pela mesma view da lista. Usada quando um
// evento Realtime chega: o evento só traz a linha crua de `notifications`. null = invisível
// (ex.: publicação removida) ou arquivada.
export async function getNotificationById(id) {
  const supabase = await getSupabase()
  const { data, error } = await supabase
    .from('notification_items')
    .select(NOTIFICATION_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? mapNotificationRow(data) : null
}

// Assina SOMENTE INSERT e UPDATE de `notifications` filtrados pelo destinatário (a RLS ainda é
// aplicada pelo Realtime com o JWT do usuário). Devolve a função que remove o canal -- chamada no
// logout e na troca de conta. `onReconnect` roda quando o canal volta a ficar SUBSCRIBED depois de
// uma queda: eventos perdidos nesse intervalo são recuperados por uma releitura, não por polling.
export function subscribeToNotifications(userId, { onInsert, onUpdate, onReconnect }) {
  let cancelled = false
  let channel = null
  let client = null
  getSupabase()
    .then((supabase) => {
      if (cancelled) return
      client = supabase
      let connectedOnce = false
      const filter = `recipient_id=eq.${userId}`
      const mine = (payload) => payload?.new && payload.new.recipient_id === userId
      channel = supabase
        .channel(`notifications-${userId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter }, (payload) => {
          if (!cancelled && mine(payload)) onInsert(payload.new)
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter }, (payload) => {
          if (!cancelled && mine(payload)) onUpdate(payload.new)
        })
        .subscribe((status) => {
          if (cancelled || status !== 'SUBSCRIBED') return
          if (connectedOnce) onReconnect()
          connectedOnce = true
        })
    })
    .catch(() => {
      // Sem Realtime a Central continua funcionando (abrir/voltar à aba relê o contador).
    })
  return () => {
    cancelled = true
    if (channel && client) {
      const removed = channel
      channel = null
      client.removeChannel(removed)
    }
  }
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

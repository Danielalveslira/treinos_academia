async function getSupabase() {
  return (await import('../../../supabase/config')).supabase
}

const NOTIFICATION_COLUMNS =
  'id,actor_id,actor_username,type,status_id,comment_id,community_id,read_at,created_at'

export async function countUnreadCommentNotifications() {
  const supabase = await getSupabase()
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) throw error
  return count || 0
}

export async function listCommentNotifications(limit = 20) {
  const supabase = await getSupabase()
  const { data, error } = await supabase
    .from('comment_notification_items')
    .select(NOTIFICATION_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 20))
  if (error) throw error
  return data.map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    type: row.type,
    statusId: row.status_id,
    commentId: row.comment_id,
    communityId: row.community_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  }))
}

export async function markCommentNotificationRead(id) {
  const supabase = await getSupabase()
  const { error } = await supabase.rpc('notifications_mark_read', {
    p_ids: [id],
    p_before: null,
  })
  if (error) throw error
}

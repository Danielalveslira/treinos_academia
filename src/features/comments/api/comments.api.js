export const ROOT_COMMENT_PAGE_SIZE = 15
export const REPLY_PAGE_SIZE = 8

const COMMENT_COLUMNS =
  'id,status_id,author_id,author_username,author_avatar_path,parent_comment_id,root_comment_id,ancestor_ids,depth,body,status,reply_count,like_count,score,created_at,updated_at,edited_at'

async function getSupabase() {
  return (await import('../../../supabase/config')).supabase
}

export function mapCommentRow(row) {
  const comment = {
    id: row.id,
    statusId: row.status_id,
    authorId: row.author_id,
    parentCommentId: row.parent_comment_id,
    rootCommentId: row.root_comment_id,
    ancestorIds: row.ancestor_ids || [],
    depth: row.depth,
    body: row.body,
    status: row.status,
    replyCount: row.reply_count,
    likeCount: row.like_count,
    score: row.score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at,
    likedByViewer: false,
  }
  if ('author_username' in row) comment.authorUsername = row.author_username
  if ('author_avatar_path' in row) comment.authorAvatarPath = row.author_avatar_path
  return comment
}

export function commentCursor(comment) {
  return { createdAt: comment.createdAt, id: comment.id, score: comment.score }
}

function applyCursor(query, cursor, ascending) {
  if (!cursor) return query
  const comparison = ascending ? 'gt' : 'lt'
  return query.or(
    `created_at.${comparison}.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.${comparison}.${cursor.id})`
  )
}

async function attachViewerLikes(comments) {
  if (comments.length === 0) return comments
  const supabase = await getSupabase()
  const ids = comments.map((comment) => comment.id)
  const { data, error } = await supabase
    .from('comment_likes')
    .select('comment_id')
    .in('comment_id', ids)
  if (error) throw error
  const liked = new Set(data.map((row) => row.comment_id))
  return comments.map((comment) => ({ ...comment, likedByViewer: liked.has(comment.id) }))
}

export async function listRootComments(
  statusId,
  { cursor = null, limit = ROOT_COMMENT_PAGE_SIZE } = {}
) {
  const supabase = await getSupabase()
  let query = supabase
    .from('comment_list_items')
    .select(COMMENT_COLUMNS)
    .eq('status_id', statusId)
    .is('parent_comment_id', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), ROOT_COMMENT_PAGE_SIZE))
  query = applyCursor(query, cursor, false)
  const { data, error } = await query
  if (error) throw error
  return attachViewerLikes(data.map(mapCommentRow))
}

export async function listReplies(
  parentCommentId,
  { cursor = null, limit = REPLY_PAGE_SIZE } = {}
) {
  const supabase = await getSupabase()
  let query = supabase
    .from('comment_list_items')
    .select(COMMENT_COLUMNS)
    .eq('parent_comment_id', parentCommentId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), REPLY_PAGE_SIZE))
  query = applyCursor(query, cursor, true)
  const { data, error } = await query
  if (error) throw error
  return attachViewerLikes(data.map(mapCommentRow))
}

export async function createComment({ statusId, parentCommentId = null, body, clientRequestId }) {
  const supabase = await getSupabase()
  const { data, error } = await supabase
    .rpc('comment_create', {
      p_status_id: statusId,
      p_parent_comment_id: parentCommentId,
      p_body: body,
      p_client_request_id: clientRequestId,
    })
    .single()
  if (error) throw error
  const { data: hydrated, error: hydrateError } = await supabase
    .from('comment_list_items')
    .select(COMMENT_COLUMNS)
    .eq('id', data.id)
    .single()
  if (hydrateError) throw hydrateError
  return mapCommentRow(hydrated)
}

export async function editComment({ commentId, body, expectedUpdatedAt }) {
  const supabase = await getSupabase()
  const { data, error } = await supabase
    .rpc('comment_edit', {
      p_comment_id: commentId,
      p_body: body,
      p_expected_updated_at: expectedUpdatedAt,
    })
    .single()
  if (error) throw error
  return mapCommentRow(data)
}

export async function deleteComment(commentId) {
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('comment_delete', { p_comment_id: commentId }).single()
  if (error) throw error
  return mapCommentRow(data)
}

export async function setCommentLike(commentId, liked) {
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('comment_set_like', {
    p_comment_id: commentId,
    p_liked: liked,
  })
  if (error) throw error
  return data
}

export async function reportComment(commentId, reason, details = null) {
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('comment_report', {
    p_comment_id: commentId,
    p_reason: reason,
    p_details: details,
  })
  if (error) throw error
  return data
}

export async function getCommentContext(commentId) {
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('comment_context', { p_comment_id: commentId })
  if (error) throw error
  return data
}

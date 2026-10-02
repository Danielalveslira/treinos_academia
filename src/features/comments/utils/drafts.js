const PREFIX = 'evolutus:comment-draft'

export function commentDraftKey(statusId, parentCommentId = null) {
  return `${PREFIX}:${statusId}:${parentCommentId || 'root'}`
}

export function readCommentDraft(statusId, parentCommentId = null) {
  try {
    return localStorage.getItem(commentDraftKey(statusId, parentCommentId)) || ''
  } catch {
    return ''
  }
}

export function writeCommentDraft(statusId, parentCommentId, value) {
  try {
    const key = commentDraftKey(statusId, parentCommentId)
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Storage may be unavailable in privacy mode. Draft persistence is best-effort.
  }
}

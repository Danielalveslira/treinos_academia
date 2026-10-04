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

// Rascunhos de comentário são por status, não por usuário: ao encerrar a sessão, o próximo
// usuário deste aparelho não deve ver o texto não enviado do anterior.
export function clearAllCommentDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(`${PREFIX}:`)) localStorage.removeItem(key)
    }
  } catch {
    // Best-effort: storage indisponível não impede o logout.
  }
}

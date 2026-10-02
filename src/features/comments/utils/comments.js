export function commentPlaceholder(status) {
  if (status === 'removed_by_moderation') return 'Comentário removido pela moderação.'
  return 'Comentário excluído.'
}

export function mergeCommentPage(current, page) {
  const seen = new Set(current.map((comment) => comment.id))
  return [...current, ...page.filter((comment) => !seen.has(comment.id))]
}

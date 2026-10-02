export const commentKeys = {
  roots: (statusId) => `comments:status:${statusId}:roots`,
  replies: (parentCommentId) => `comments:parent:${parentCommentId}:replies`,
  detail: (commentId) => `comments:detail:${commentId}`,
}

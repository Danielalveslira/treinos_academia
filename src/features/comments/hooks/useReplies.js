import { useCallback } from 'react'
import { listReplies, REPLY_PAGE_SIZE } from '../api/comments.api'
import { useCommentList } from './useCommentList'

export function useReplies(parentCommentId, enabled) {
  const loadPage = useCallback(
    (cursor) => listReplies(parentCommentId, { cursor, limit: REPLY_PAGE_SIZE }),
    [parentCommentId]
  )
  return useCommentList({ enabled, loadPage, pageSize: REPLY_PAGE_SIZE })
}

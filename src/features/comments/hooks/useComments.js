import { useCallback } from 'react'
import { listRootComments, ROOT_COMMENT_PAGE_SIZE } from '../api/comments.api'
import { useCommentList } from './useCommentList'

export function useComments(statusId, enabled) {
  const loadPage = useCallback(
    (cursor) => listRootComments(statusId, { cursor, limit: ROOT_COMMENT_PAGE_SIZE }),
    [statusId]
  )
  return useCommentList({ enabled, loadPage, pageSize: ROOT_COMMENT_PAGE_SIZE })
}

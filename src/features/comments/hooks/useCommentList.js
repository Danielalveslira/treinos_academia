import { useCallback, useEffect, useRef, useState } from 'react'
import { commentCursor } from '../api/comments.api'
import { mergeCommentPage } from '../utils/comments'

export function useCommentList({ enabled, loadPage, pageSize }) {
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(true)
  const [ready, setReady] = useState(false)
  const revision = useRef(0)

  const load = useCallback(
    async ({ reset = false } = {}) => {
      if (!enabled || loading) return
      const currentRevision = ++revision.current
      setLoading(true)
      setError(null)
      try {
        const base = reset ? [] : comments
        const cursor = base.length ? commentCursor(base[base.length - 1]) : null
        const page = await loadPage(cursor)
        if (revision.current !== currentRevision) return
        setComments(reset ? page : mergeCommentPage(base, page))
        setHasMore(page.length === pageSize)
        setReady(true)
      } catch (nextError) {
        if (revision.current === currentRevision) setError(nextError)
      } finally {
        if (revision.current === currentRevision) setLoading(false)
      }
    },
    [comments, enabled, loadPage, loading, pageSize]
  )

  useEffect(() => {
    if (!enabled || ready || loading || error) return
    load({ reset: true })
  }, [enabled, error, load, loading, ready])

  useEffect(
    () => () => {
      revision.current += 1
    },
    []
  )

  const addComment = useCallback((comment, placement = 'end') => {
    setComments((current) =>
      current.some((item) => item.id === comment.id)
        ? current
        : placement === 'start'
          ? [comment, ...current]
          : [...current, comment]
    )
  }, [])

  const updateComment = useCallback((commentId, updater) => {
    setComments((current) =>
      current.map((comment) =>
        comment.id === commentId
          ? typeof updater === 'function'
            ? updater(comment)
            : { ...comment, ...updater }
          : comment
      )
    )
  }, [])

  return {
    comments,
    loading,
    error,
    hasMore,
    loadMore: () => load(),
    retry: () => load({ reset: comments.length === 0 }),
    addComment,
    updateComment,
  }
}

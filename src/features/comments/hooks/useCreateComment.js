import { useCallback, useRef, useState } from 'react'
import { createComment } from '../api/comments.api'

export function useCreateComment(statusId, parentCommentId = null) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const requestId = useRef(null)

  const submit = useCallback(
    async (body) => {
      if (pending) return null
      requestId.current ||= crypto.randomUUID()
      setPending(true)
      setError(null)
      try {
        const comment = await createComment({
          statusId,
          parentCommentId,
          body,
          clientRequestId: requestId.current,
        })
        requestId.current = null
        return comment
      } catch (nextError) {
        setError(nextError)
        throw nextError
      } finally {
        setPending(false)
      }
    },
    [parentCommentId, pending, statusId]
  )

  return { submit, pending, error, clearError: () => setError(null) }
}

import { useEffect, useState } from 'react'
import { readCommentDraft, writeCommentDraft } from '../utils/drafts'

export function useCommentDraft(statusId, parentCommentId = null) {
  const [value, setValue] = useState(() => readCommentDraft(statusId, parentCommentId))

  useEffect(() => {
    const timer = window.setTimeout(() => writeCommentDraft(statusId, parentCommentId, value), 250)
    return () => window.clearTimeout(timer)
  }, [parentCommentId, statusId, value])

  function clear() {
    setValue('')
    writeCommentDraft(statusId, parentCommentId, '')
  }

  return { value, setValue, clear }
}

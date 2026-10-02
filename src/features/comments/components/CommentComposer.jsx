import { useState } from 'react'
import { Button, Text } from '@primer/react'
import { useCommentDraft } from '../hooks/useCommentDraft'
import { useCreateComment } from '../hooks/useCreateComment'

const MAX_COMMENT_LENGTH = 8000

export function CommentComposer({ statusId, parentCommentId = null, onCreated, onCancel }) {
  const draft = useCommentDraft(statusId, parentCommentId)
  const mutation = useCreateComment(statusId, parentCommentId)
  const [validationError, setValidationError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    const body = draft.value.trim()
    if (!body) {
      setValidationError('Escreva um comentário.')
      return
    }
    if (body.length > MAX_COMMENT_LENGTH) {
      setValidationError(`Use no máximo ${MAX_COMMENT_LENGTH} caracteres.`)
      return
    }
    setValidationError('')
    try {
      const comment = await mutation.submit(body)
      if (!comment) return
      draft.clear()
      onCreated(comment)
    } catch {
      // The same client_request_id remains available for an idempotent retry.
    }
  }

  const error =
    validationError || (mutation.error ? 'Não foi possível publicar. Tente novamente.' : '')

  return (
    <form className="comment-composer" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={`comment-${parentCommentId || statusId}`}>
        {parentCommentId ? 'Escreva uma resposta' : 'Escreva um comentário'}
      </label>
      <textarea
        id={`comment-${parentCommentId || statusId}`}
        value={draft.value}
        maxLength={MAX_COMMENT_LENGTH}
        rows="2"
        placeholder={parentCommentId ? 'Escreva uma resposta…' : 'Escreva um comentário…'}
        disabled={mutation.pending}
        onChange={(event) => {
          draft.setValue(event.target.value)
          setValidationError('')
          mutation.clearError()
        }}
      />
      <div className="comment-composer-footer">
        {draft.value.length > 0 && (
          <Text className="comment-character-count">
            {draft.value.length}/{MAX_COMMENT_LENGTH}
          </Text>
        )}
        {onCancel && (
          <Button type="button" size="small" variant="invisible" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button
          type="submit"
          size="small"
          variant={draft.value.trim() ? 'primary' : 'invisible'}
          disabled={mutation.pending || !draft.value.trim()}
        >
          {mutation.pending ? 'Publicando…' : parentCommentId ? 'Responder' : 'Comentar'}
        </Button>
      </div>
      {error && (
        <Text className="comment-error" role="alert">
          {error}
        </Text>
      )}
    </form>
  )
}

import { useState } from 'react'
import { Button, Text } from '@primer/react'
import { useComments } from '../hooks/useComments'
import { CommentCard } from './CommentCard'
import { CommentComposer } from './CommentComposer'

export function CommentSection({
  statusId,
  communityId,
  initialCount = 0,
  currentUserId,
  canModerate = false,
  allowWrite = true,
}) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(initialCount)
  const comments = useComments(statusId, open)

  if (!open) {
    return (
      <div className="comment-section-collapsed">
        <Button size="small" variant="invisible" onClick={() => setOpen(true)}>
          {count === 0 ? 'Comentar' : `${count} ${count === 1 ? 'comentário' : 'comentários'}`}
        </Button>
      </div>
    )
  }

  return (
    <section className="comment-section" aria-label="Comentários">
      <div className="comment-section-heading">
        <Text as="h3">Comentários</Text>
        <Button size="small" variant="invisible" onClick={() => setOpen(false)}>
          Recolher
        </Button>
      </div>
      {allowWrite && (
        <CommentComposer
          statusId={statusId}
          onCreated={(comment) => {
            comments.addComment({ ...comment, _isNew: true }, 'start')
            setCount((value) => value + 1)
          }}
        />
      )}
      {comments.loading && comments.comments.length === 0 && (
        <div className="comment-loading" role="status" aria-label="Carregando comentários">
          <span />
          <span />
        </div>
      )}
      {comments.error && (
        <div className="comment-state is-error" role="alert">
          <Text>Não foi possível carregar os comentários.</Text>
          <Button size="small" variant="invisible" onClick={comments.retry}>
            Tentar novamente
          </Button>
        </div>
      )}
      {!comments.loading && !comments.error && comments.comments.length === 0 && (
        <Text className="comment-empty">
          Nenhum comentário ainda. Seja o primeiro a participar.
        </Text>
      )}
      <div className="comment-list">
        {comments.comments.map((comment) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            communityId={communityId}
            currentUserId={currentUserId}
            canModerate={canModerate}
            allowWrite={allowWrite}
            onCommentCreated={() => setCount((value) => value + 1)}
            onChange={(next) => comments.updateComment(comment.id, next)}
            visuallyNew={Boolean(comment._isNew)}
          />
        ))}
      </div>
      {comments.hasMore && comments.comments.length > 0 && (
        <div className="comment-pagination">
          <Button
            size="small"
            variant="invisible"
            disabled={comments.loading}
            onClick={comments.loadMore}
          >
            {comments.loading ? 'Carregando…' : 'Ver mais comentários'}
          </Button>
        </div>
      )}
    </section>
  )
}

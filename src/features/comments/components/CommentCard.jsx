import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Spinner, Text } from '@primer/react'
import { ProfileAvatar } from '../../../components/ProfileAvatar'
import { AuthorRoleBadge } from '../../../components/AuthorRoleBadge'
import { formatDateTime } from '../../../utils/format'
import { toDate } from '../../../utils/date'
import { deleteComment, editComment, setCommentLike } from '../api/comments.api'
import { useReplies } from '../hooks/useReplies'
import { commentPlaceholder } from '../utils/comments'
import { CommentComposer } from './CommentComposer'
import { describeAccountAccessError } from '../../../utils/accountAccessErrors'
import { CommentReportForm } from './CommentReportForm'

export function CommentCard({
  comment,
  communityId,
  currentUserId,
  canModerate = false,
  allowWrite = true,
  onChange,
  onCommentCreated,
  highlighted = false,
  visuallyNew = false,
  visualDepth = 0,
  contextMode = false,
  replyingToUsername = null,
  showPermalink = true,
}) {
  const [current, setCurrent] = useState(comment)
  const [expanded, setExpanded] = useState(false)
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(comment.body || '')
  const [reporting, setReporting] = useState(false)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [animateHighlight, setAnimateHighlight] = useState(highlighted || visuallyNew)
  // Na página de conversa só o comentário aberto carrega respostas (sob demanda);
  // os ancestrais já aparecem como caminho e não repetem seus ramos.
  const showReplies = !contextMode || highlighted
  const replies = useReplies(current.id, showReplies && expanded)

  useEffect(() => setCurrent(comment), [comment])
  useEffect(() => {
    if (!highlighted && !visuallyNew) return undefined
    setAnimateHighlight(true)
    const timer = window.setTimeout(() => setAnimateHighlight(false), 1800)
    return () => window.clearTimeout(timer)
  }, [highlighted, visuallyNew])

  function replace(next) {
    const merged = { ...current, ...next }
    setCurrent(merged)
    onChange?.(merged)
  }

  async function saveEdit() {
    const body = editBody.trim()
    if (!body || pending) return
    setPending(true)
    setMessage('')
    setNotice('')
    try {
      replace(
        await editComment({
          commentId: current.id,
          body,
          expectedUpdatedAt: current.updatedAt,
        })
      )
      setEditing(false)
    } catch {
      setMessage('O comentário mudou ou não pôde ser editado. Atualize e tente novamente.')
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (pending) return
    setPending(true)
    setMessage('')
    setNotice('')
    try {
      replace(await deleteComment(current.id))
      setEditing(false)
      setReplying(false)
      setConfirmingDelete(false)
    } catch (err) {
      setMessage(describeAccountAccessError(err?.message) || 'Não foi possível excluir o comentário.')
    } finally {
      setPending(false)
    }
  }

  async function toggleLike() {
    if (pending) return
    const liked = !current.likedByViewer
    const previous = current
    replace({
      ...current,
      likedByViewer: liked,
      likeCount: Math.max(0, current.likeCount + (liked ? 1 : -1)),
    })
    setPending(true)
    setMessage('')
    setNotice('')
    try {
      const result = await setCommentLike(current.id, liked)
      replace({ ...current, likedByViewer: result.liked, likeCount: result.likeCount })
    } catch {
      replace(previous)
      setMessage('Não foi possível atualizar a curtida.')
    } finally {
      setPending(false)
    }
  }

  const isActive = current.status === 'active'
  const isAuthor = current.authorId === currentUserId
  const permalink = `/comunidades/${communityId}/publicacoes/${current.statusId}/comentarios/${current.id}`
  const repliesId = `respostas-${current.id}`
  const safeVisualDepth = Math.min(visualDepth, 3)

  return (
    <article
      className={`comment-card${highlighted ? ' is-highlighted' : ''}${animateHighlight ? ' is-entering' : ''}${contextMode ? ' is-context' : ''}`}
      style={{ '--comment-depth': safeVisualDepth }}
      id={`comentario-${current.id}`}
      tabIndex={highlighted ? -1 : undefined}
    >
      <header className="comment-header">
        <ProfileAvatar
          path={current.authorAvatarPath}
          name={current.authorUsername || 'M'}
          className="comment-avatar"
        />
        <div className="comment-meta">
          <span className="comment-author-row">
            <Text className="comment-author">
              {current.authorId
                ? current.authorUsername
                  ? `@${current.authorUsername}`
                  : 'Membro'
                : 'Usuário indisponível'}
            </Text>
            <AuthorRoleBadge
              isSuperAdmin={current.authorIsSuperAdmin}
              isCommunityAdmin={current.authorIsCommunityAdmin}
            />
          </span>
          <Text className="comment-date">
            {formatDateTime(toDate(current.createdAt))}
            {current.editedAt ? ' · editado' : ''}
          </Text>
          {replyingToUsername && (
            <Text className="comment-replying-to">
              respondeu a{' '}
              {replyingToUsername.startsWith('@') ? replyingToUsername : `@${replyingToUsername}`}
            </Text>
          )}
        </div>
      </header>

      {editing ? (
        <div className="comment-edit-form">
          <textarea
            rows="3"
            maxLength="8000"
            aria-label="Editar comentário"
            value={editBody}
            onChange={(event) => setEditBody(event.target.value)}
          />
          <div className="comment-inline-actions">
            <Button size="small" variant="invisible" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button size="small" variant="primary" disabled={pending} onClick={saveEdit}>
              Salvar
            </Button>
          </div>
        </div>
      ) : (
        <Text as="p" className={isActive ? 'comment-body' : 'comment-placeholder'}>
          {isActive ? current.body : commentPlaceholder(current.status)}
        </Text>
      )}

      <div className="comment-actions">
        {isActive && allowWrite && (
          <Button size="small" variant="invisible" disabled={pending} onClick={toggleLike}>
            {current.likedByViewer ? 'Curtido' : 'Curtir'}
            {current.likeCount ? ` (${current.likeCount})` : ''}
          </Button>
        )}
        {isActive && allowWrite && (
          <Button
            size="small"
            variant="invisible"
            onClick={() => {
              setExpanded(true)
              setReplying((value) => !value)
            }}
          >
            Responder
          </Button>
        )}
        {isActive && isAuthor && (
          <Button size="small" variant="invisible" onClick={() => setEditing(true)}>
            Editar
          </Button>
        )}
        {isActive && (isAuthor || canModerate) && (
          <Button
            size="small"
            variant="invisible"
            disabled={pending}
            onClick={() => setConfirmingDelete(true)}
          >
            Excluir
          </Button>
        )}
        {isActive && !isAuthor && (
          <Button size="small" variant="invisible" onClick={() => setReporting((value) => !value)}>
            Denunciar
          </Button>
        )}
        {showPermalink && (
          <Button as={Link} to={permalink} size="small" variant="invisible">
            Link
          </Button>
        )}
      </div>

      {confirmingDelete && (
        <div
          className="comment-delete-confirmation"
          role="alertdialog"
          aria-label="Excluir comentário"
        >
          <Text>O texto será removido. As respostas serão preservadas.</Text>
          <div className="comment-inline-actions">
            <Button size="small" variant="invisible" onClick={() => setConfirmingDelete(false)}>
              Cancelar
            </Button>
            <Button size="small" variant="danger" disabled={pending} onClick={remove}>
              Excluir comentário
            </Button>
          </div>
        </div>
      )}

      {message && (
        <Text className="comment-error" role="alert">
          {message}
        </Text>
      )}
      {notice && (
        <Text className="comment-success" role="status">
          {notice}
        </Text>
      )}
      {reporting && (
        <CommentReportForm
          commentId={current.id}
          onClose={(sent) => {
            setReporting(false)
            if (sent) setNotice('Denúncia enviada para análise.')
          }}
        />
      )}
      {replying && (
        <CommentComposer
          statusId={current.statusId}
          parentCommentId={current.id}
          onCancel={() => setReplying(false)}
          onCreated={(reply) => {
            setExpanded(true)
            replies.addComment({ ...reply, _isNew: true })
            replace({ ...current, replyCount: current.replyCount + 1 })
            // O comentário aberto exibe a nova resposta inline; ancestrais navegam até ela.
            if (!contextMode || !highlighted) onCommentCreated?.(reply)
            setReplying(false)
          }}
        />
      )}

      {showReplies && current.replyCount > 0 && (
        <Button
          className="comment-thread-toggle"
          size="small"
          variant="invisible"
          aria-expanded={expanded}
          aria-controls={repliesId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? 'Recolher respostas'
            : `Ver ${current.replyCount} ${current.replyCount === 1 ? 'resposta' : 'respostas'}`}
        </Button>
      )}
      {showReplies && expanded && (
        <div
          className={`comment-replies${visualDepth >= 3 ? ' is-depth-capped' : ''}`}
          id={repliesId}
        >
          {replies.loading && replies.comments.length === 0 && (
            <span className="comment-replies-loading" role="status">
              <Spinner size="small" /> Carregando respostas…
            </span>
          )}
          {replies.error && (
            <div className="comment-state is-error" role="alert">
              <Text>Não foi possível carregar as respostas.</Text>
              <Button size="small" variant="invisible" onClick={replies.retry}>
                Tentar novamente
              </Button>
            </div>
          )}
          {replies.comments.map((reply) => (
            <CommentCard
              key={reply.id}
              comment={reply}
              communityId={communityId}
              currentUserId={currentUserId}
              canModerate={canModerate}
              allowWrite={allowWrite}
              onCommentCreated={onCommentCreated}
              onChange={(next) => replies.updateComment(reply.id, next)}
              visuallyNew={Boolean(reply._isNew)}
              visualDepth={safeVisualDepth + 1}
              replyingToUsername={current.authorUsername || null}
            />
          ))}
          {replies.hasMore && replies.comments.length > 0 && (
            <Button
              size="small"
              variant="invisible"
              disabled={replies.loading}
              onClick={replies.loadMore}
            >
              {replies.loading ? 'Carregando…' : 'Ver mais respostas'}
            </Button>
          )}
          {!replies.loading &&
            !replies.error &&
            !replies.hasMore &&
            replies.comments.length > 0 && (
              <Text className="comment-replies-end">Fim das respostas</Text>
            )}
        </div>
      )}
    </article>
  )
}

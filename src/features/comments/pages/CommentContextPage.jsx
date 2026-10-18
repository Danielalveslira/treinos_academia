import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Heading, Text } from '@primer/react'
import { ChevronLeftIcon } from '@primer/octicons-react'
import { useAuth } from '../../../hooks/useAuth'
import { useCommunityAuthorAvatars } from '../../../hooks/useCommunityAuthorAvatars'
import { getCommunitySummary } from '../../../services/communitiesService'
import { getStatusSummary } from '../../../services/statusesService'
import { canModerateCommunity } from '../../../utils/communityOwnership'
import { isPublicationInteractionActive } from '../../../utils/statusAvailability'
import { getCommentContext } from '../api/comments.api'
import { CommentCard } from '../components/CommentCard'
import { CommentPublicationSummary } from '../components/CommentPublicationSummary'

export default function CommentContextPage() {
  const { id: communityId, statusId, commentId } = useParams()
  const navigate = useNavigate()
  const { user, isSuperAdmin } = useAuth()
  const [context, setContext] = useState(null)
  const [status, setStatus] = useState(null)
  const [community, setCommunity] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    let active = true

    async function loadContext() {
      setLoading(true)
      setError('')
      setContext(null)
      setStatus(null)
      try {
        const nextContext = await getCommentContext(commentId)
        if (
          !nextContext ||
          nextContext.statusId !== statusId ||
          nextContext.communityId !== communityId
        ) {
          throw new Error('NOT_FOUND')
        }
        const [nextStatus, nextCommunity] = await Promise.all([
          getStatusSummary(nextContext.statusId),
          getCommunitySummary(nextContext.communityId),
        ])
        if (!nextStatus || !nextCommunity) throw new Error('NOT_FOUND')
        if (!active) return
        setContext(nextContext)
        setStatus(nextStatus)
        setCommunity(nextCommunity)
      } catch {
        if (active) setError('Esta conversa não está disponível ou você não tem acesso.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadContext()
    return () => {
      active = false
    }
  }, [commentId, communityId, retryToken, statusId])

  // The push route loads its context asynchronously; scroll only once that target is mounted.
  useEffect(() => {
    if (loading || error || !context?.statusId) return
    const target = document.getElementById(`comentario-${commentId}`)
    target?.scrollIntoView({ block: 'start' })
    target?.focus({ preventScroll: true })
  }, [commentId, context?.statusId, loading, error])

  const authorAvatars = useCommunityAuthorAvatars(Boolean(status), status ? [status] : [])
  const publicationAnchor =
    status?.type === 'workout' ? `treino-${statusId}` : `publicacao-${statusId}`
  const publicationPath = `/comunidades/${communityId}#${publicationAnchor}`
  const canModerate = canModerateCommunity({
    isSuperAdmin,
    communityOwnerId: community?.ownerId,
    uid: user?.uid,
  })
  const allowWrite = status ? isPublicationInteractionActive(status, new Date()) : false

  return (
    <main className="comment-context-page">
      <Link to={publicationPath} className="comment-context-back">
        <ChevronLeftIcon /> Voltar à publicação
      </Link>

      {loading && (
        <div className="comment-context-loading" role="status" aria-label="Carregando conversa">
          <span />
          <span />
          <span />
        </div>
      )}

      {error && (
        <div className="comment-context-error" role="alert">
          <Heading as="h1">Conversa indisponível</Heading>
          <Text>{error}</Text>
          <Button size="small" onClick={() => setRetryToken((value) => value + 1)}>
            Tentar novamente
          </Button>
        </div>
      )}

      {context && status && community && (
        <>
          <div className="comment-context-heading">
            <Text>{community.name}</Text>
            <Heading as="h1">Conversa</Heading>
            <Text>
              {context.comments.length === 1
                ? 'Comentário aberto na publicação.'
                : 'Acompanhe quem respondeu a quem.'}
            </Text>
          </div>

          <CommentPublicationSummary
            status={status}
            communityName={community.name}
            authorAvatarPath={authorAvatars[status.authorId]}
          />

          <section className="comment-context-conversation" aria-labelledby="conversation-title">
            <div className="comment-context-section-heading">
              <Heading as="h2" id="conversation-title">
                Comentários
              </Heading>
              <Text>{context.comments.length} na conversa</Text>
            </div>
            <div className="comment-context-thread">
              {context.comments.map((comment, index) => {
                const previous = context.comments[index - 1]
                return (
                  <CommentCard
                    key={comment.id}
                    comment={comment}
                    communityId={communityId}
                    currentUserId={user?.uid}
                    canModerate={canModerate}
                    allowWrite={allowWrite}
                    highlighted={comment.id === commentId}
                    contextMode
                    showPermalink={false}
                    visualDepth={index}
                    replyingToUsername={previous?.authorUsername || null}
                    onChange={(next) =>
                      setContext((current) => ({
                        ...current,
                        comments: current.comments.map((item) =>
                          item.id === comment.id ? next : item
                        ),
                      }))
                    }
                    onCommentCreated={(reply) =>
                      navigate(
                        `/comunidades/${communityId}/publicacoes/${statusId}/comentarios/${reply.id}`
                      )
                    }
                  />
                )
              })}
            </div>
          </section>
        </>
      )}
    </main>
  )
}

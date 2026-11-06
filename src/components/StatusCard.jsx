import { lazy, memo, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Text, Button, Flash, IconButton } from '@primer/react'
import {
  TrashIcon,
  PencilIcon,
  PersonIcon,
  LocationIcon,
  ClockIcon,
  CheckIcon,
  CalendarIcon,
  PeopleIcon,
  XIcon,
} from '@primer/octicons-react'
import { voteOnPoll, joinWorkout, leaveWorkout } from '../services/statusesService'
import { loadPollState, loadWorkoutState } from '../services/statusInteractionsService'
import { ExpiryBadge } from './ExpiryBadge'
import { EconomyVoteBar } from './EconomyVoteBar'
import { AchievementSummary } from './AchievementSummary'
import { AuthorRoleBadge } from './AuthorRoleBadge'
import { StatusText } from './StatusText'
import { PhotoStatus } from './PhotoStatus'
import { StatusEditForm } from './StatusEditForm'
import { ProfileAvatar } from './ProfileAvatar'
import { ShareMenu } from './ShareMenu'
import { PromotedBadge } from './PromotedBadge'
import { LazyDialogBoundary } from './LazyDialogBoundary'
import { CommentSection } from '../features/comments/components/CommentSection'
import { COMMENTS_ENABLED } from '../features/comments/config'
import { formatDateTime } from '../utils/format'
import { getCached, setCached } from '../utils/pageCache'
import { isReportableAuthor } from '../utils/moderation'
import { toDate } from '../utils/date.js'
import { toMillis } from '../utils/expiry.js'
import { isPublicationInteractionActive } from '../utils/statusAvailability.js'
import {
  describeScheduledWorkoutState,
  isScheduledWorkoutJoinable,
  nextWorkoutParticipationState,
} from '../utils/scheduledWorkout'
import { buildIcsEvent, downloadIcsFile } from '../utils/icsExport'
import { useNowSelector } from '../utils/clock'
import '../styles/workout-status.css'

// Diálogos que quase ninguém abre a cada visita ao feed: só baixam quando o usuário os abre.
const PromoteDialog = lazy(() =>
  import('./PromoteDialog').then((module) => ({ default: module.PromoteDialog }))
)
const WorkoutParticipantsDialog = lazy(() =>
  import('./WorkoutParticipantsDialog').then((module) => ({
    default: module.WorkoutParticipantsDialog,
  }))
)

// Todo erro contextual hoje é transitório (voto, enquete, participação, exclusão --
// sempre resolve tentando de novo), então some sozinho depois de um tempo pra não virar
// lixo visual acumulado no card. O X abaixo cobre o caso de alguém querer descartar
// antes disso.
const ACTION_ERROR_AUTO_DISMISS_MS = 6000

function StatusHeader({
  status,
  authorAvatarPath,
  now,
  canDelete,
  onDelete,
  deleting,
  canEdit,
  onEdit,
  showToast,
}) {
  // author_username é uma coluna text (nulo ou string por natureza), mas nunca custa
  // nada tratar dado inesperado com cuidado aqui também — um valor de outro tipo (ex.:
  // number) não deveria derrubar o card inteiro, só cair no "M" padrão.
  const authorUsername = typeof status.authorUsername === 'string' ? status.authorUsername : null
  return (
    <header className="status-header">
      <ProfileAvatar
        path={authorAvatarPath}
        name={authorUsername || 'M'}
        className="status-author-avatar"
        lazy
      />
      <div className="status-header-main">
        <div className="status-author-row">
          <Link to={`/comunidades/perfil/${status.authorId}`} className="status-author">
            {authorUsername ? `@${authorUsername}` : 'Membro'}
          </Link>
          <AuthorRoleBadge
            isSuperAdmin={status.authorIsSuperAdmin}
            isCommunityAdmin={status.authorIsCommunityAdmin}
          />
        </div>
        <span className="status-time">
          {formatDateTime(toDate(status.createdAt))}
          {status.editedAt ? ' · editado' : ''}
        </span>
      </div>
      <div className="status-header-actions">
        <ExpiryBadge status={status} now={now} />
        <ShareMenu status={status} showToast={showToast} />
        {canEdit && (
          <IconButton
            icon={PencilIcon}
            variant="invisible"
            size="small"
            aria-label="Editar publicação"
            onClick={onEdit}
          />
        )}
        {canDelete && (
          <IconButton
            icon={TrashIcon}
            variant="invisible"
            size="small"
            aria-label="Excluir publicação"
            onClick={() => onDelete(status)}
            disabled={deleting}
          />
        )}
      </div>
    </header>
  )
}

function PollStatus({
  status,
  currentUserId,
  showToast,
  onActionSuccess,
  interactionActive,
  refreshEpoch,
}) {
  // counts/myOptionId em vez da lista de votos: nunca baixa a subcoleção inteira (uma
  // enquete popular pode ter milhares de votos) — só contagens agregadas por opção
  // (no máximo 6, teto do schema) e o meu próprio voto, 1 leitura direta pelo id.
  const cacheKey = `pollStatus:${status.id}:${currentUserId}`
  const cached = getCached(cacheKey)
  const [counts, setCounts] = useState(cached?.counts ?? null)
  const [myOptionId, setMyOptionId] = useState(cached?.myOptionId ?? null)
  const [voting, setVoting] = useState(false)
  // Sem isto, uma falha de rede ou de permissão (publicação removida, acesso
  // revogado) deixava counts para sempre null: a enquete ficava sem contagens e sem
  // nenhum aviso, e o usuário não tinha como saber se ainda estava carregando ou se
  // já tinha falhado de vez. loadError + o botão "Tentar novamente" abaixo cobrem isso.
  const [loadError, setLoadError] = useState(false)
  const [retryToken, setRetryToken] = useState(0)
  // "Atualizar" manual do feed: recarrega os totais e o meu voto (a cache só vale para a primeira montagem).
  const [initialEpoch] = useState(refreshEpoch)
  // O constraint statuses_content_shape só valida a quantidade de opções (2 a 6), não o
  // shape de cada item -- então, mesmo raciocínio do authorUsername acima: um item
  // inesperado (ex.: null) não deveria quebrar a renderização de toda a enquete, só ser
  // ignorado.
  const options = (status.poll?.options || []).filter(
    (option) => option && typeof option.id === 'string' && typeof option.label === 'string'
  )
  const optionIds = options.map((option) => option.id)

  useEffect(() => {
    if (cached && refreshEpoch === initialEpoch) return
    let active = true
    setLoadError(false)
    // Os cards de uma mesma renderização do feed são agrupados em 1 chamada (ver
    // statusInteractionsService.js); opções sem voto entram com 0.
    loadPollState(status.id, currentUserId)
      .then((state) => {
        if (!active) return
        const results = { ...Object.fromEntries(optionIds.map((id) => [id, 0])), ...state?.counts }
        const myOptionId = state?.myOptionId ?? null
        setCounts(results)
        setMyOptionId(myOptionId)
        setCached(cacheKey, { counts: results, myOptionId })
      })
      .catch((error) => {
        if (!active) return
        console.error('[PollStatus] loadPollState:', error)
        setLoadError(true)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.id, currentUserId, retryToken, refreshEpoch])

  const total = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : 0

  async function handleVote(optionId) {
    if (myOptionId || voting) return
    setVoting(true)
    try {
      await voteOnPoll(status.id, currentUserId, optionId)
      setCounts((prev) => {
        const next = { ...prev, [optionId]: (prev?.[optionId] || 0) + 1 }
        setCached(cacheKey, { counts: next, myOptionId: optionId })
        return next
      })
      setMyOptionId(optionId)
      onActionSuccess?.()
    } catch (error) {
      console.error('[PollStatus] voteOnPoll:', error)
      showToast?.('Não foi possível registrar seu voto. Tente novamente.', 'danger')
    } finally {
      setVoting(false)
    }
  }

  if (loadError && !counts) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Text sx={{ fontSize: 0, color: 'danger.fg' }}>Não foi possível carregar a enquete.</Text>
        <Button size="small" onClick={() => setRetryToken((token) => token + 1)}>
          Tentar novamente
        </Button>
      </Box>
    )
  }

  const votable = Boolean(counts) && !myOptionId && interactionActive

  return (
    <div>
      <span className="status-poll-question">{status.poll?.question}</span>
      <div className="status-poll-options">
        {options.map((option) => {
          const count = counts?.[option.id] || 0
          const fraction = total > 0 ? count / total : 0
          const percent = Math.round(fraction * 100)
          const className = `status-poll-option${myOptionId === option.id ? ' is-mine' : ''}`
          const content = (
            <>
              {counts && (
                <span className="status-poll-fill" style={{ '--poll-fraction': fraction }} />
              )}
              <span className="status-poll-label">{option.label}</span>
              {counts && (
                <span className="status-poll-value">
                  {percent}% ({count})
                </span>
              )}
            </>
          )
          return votable ? (
            <button
              key={option.id}
              type="button"
              className={className}
              disabled={voting}
              onClick={() => handleVote(option.id)}
            >
              {content}
            </button>
          ) : (
            <div key={option.id} className={className}>
              {content}
            </div>
          )
        })}
      </div>
      {counts && (
        <span className="status-poll-total">
          {total} {total === 1 ? 'voto' : 'votos'}
        </span>
      )}
    </div>
  )
}

// Treino Marcado V1: identidade própria (título, estado temporal calculado a partir de
// workout.date -- nunca de expiresAt, ver utils/scheduledWorkout.js), organizador,
// participação e "Adicionar ao calendário". `now` vem do relógio já compartilhado pelo
// feed (useCommunityFeed.js, atualizado a cada 15s) -- nenhum setInterval novo só para
// este card.
function WorkoutStatus({
  status,
  currentUserId,
  showToast,
  onActionSuccess,
  now,
  communityName,
  refreshEpoch,
}) {
  // Contagem agregada + 1 leitura direta pelo id (não a lista inteira de participantes)
  // — mesmo raciocínio da enquete: nunca escala com o número de pessoas confirmadas.
  // A lista de nomes (quem confirmou) NÃO é buscada automaticamente aqui: um preview
  // fixo (ex. "Daniel, Pedro e +5") exigiria chamar a Function a cada card renderizado,
  // multiplicando o custo pelo número de treinos marcados na tela -- só o botão "Ver
  // participantes" abaixo chama listWorkoutParticipants, sob demanda, uma vez.
  const cacheKey = `workoutStatus:${status.id}:${currentUserId}`
  const cached = getCached(cacheKey)
  const [count, setCount] = useState(cached?.count ?? null)
  const [amParticipant, setAmParticipant] = useState(cached?.amParticipant ?? false)
  const [pending, setPending] = useState(false)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  // Mesmo raciocínio da enquete: sem isso, uma falha de rede/permissão deixava o botão
  // desabilitado (count === null) pra sempre, sem nenhuma explicação de por quê.
  const [loadError, setLoadError] = useState(false)
  const [retryToken, setRetryToken] = useState(0)
  const [initialEpoch] = useState(refreshEpoch)

  useEffect(() => {
    if (cached && refreshEpoch === initialEpoch) return
    let active = true
    setLoadError(false)
    loadWorkoutState(status.id, currentUserId)
      .then((state) => {
        if (!active) return
        const total = state?.count ?? 0
        const mine = state?.amParticipant ?? false
        setCount(total)
        setAmParticipant(mine)
        setCached(cacheKey, { count: total, amParticipant: mine })
      })
      .catch((error) => {
        if (!active) return
        console.error('[WorkoutStatus] loadWorkoutState:', error)
        setLoadError(true)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.id, currentUserId, retryToken, refreshEpoch])

  async function toggle() {
    setPending(true)
    try {
      if (amParticipant) {
        await leaveWorkout(status.id, currentUserId)
        setCount((prev) => {
          const next = nextWorkoutParticipationState(prev, false)
          setCached(cacheKey, next)
          return next.count
        })
        setAmParticipant(false)
      } else {
        await joinWorkout(status.id, currentUserId)
        setCount((prev) => {
          const next = nextWorkoutParticipationState(prev, true)
          setCached(cacheKey, next)
          return next.count
        })
        setAmParticipant(true)
      }
      onActionSuccess?.()
    } catch (error) {
      console.error('[WorkoutStatus] joinWorkout/leaveWorkout:', error)
      showToast?.('Não foi possível atualizar sua participação. Tente novamente.', 'danger')
    } finally {
      setPending(false)
    }
  }

  function addToCalendar() {
    const dateMs = toMillis(status.workout.date)
    const ics = buildIcsEvent({
      uid: `${status.id}@evolutus`,
      title: status.workout.title,
      startMs: dateMs,
      location: status.workout.location,
      description: communityName
        ? `Comunidade Evolutus: ${communityName}`
        : 'Treino marcado no Evolutus',
    })
    downloadIcsFile(`${status.workout.title || 'treino'}.ics`, ics)
  }

  const dateMs = toMillis(status.workout.date)
  // Estado do treino pelo relógio compartilhado, por seletor: re-renderiza só quando o rótulo ou a
  // possibilidade de participar mudam (não a cada tick).
  const stateKey = useNowSelector(
    now,
    (n) => describeScheduledWorkoutState(dateMs, n).key,
    toMillis
  )
  const stateLabel = useNowSelector(
    now,
    (n) => describeScheduledWorkoutState(dateMs, n).label,
    toMillis
  )
  const joinable = useNowSelector(now, (n) => isScheduledWorkoutJoinable(dateMs, n), toMillis)
  const state = { key: stateKey, label: stateLabel }
  const organizerUsername = typeof status.authorUsername === 'string' ? status.authorUsername : null

  return (
    <Box className="workout-status">
      <Text className="workout-status-label">
        <CalendarIcon size={14} /> Treino marcado
      </Text>
      <Text sx={{ fontWeight: 'bold', fontSize: 1, display: 'block', mb: 2 }}>
        {status.workout.title}
      </Text>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted' }}>
          <ClockIcon size={14} />
          <Text sx={{ fontSize: 0 }}>{formatDateTime(toDate(status.workout.date))}</Text>
        </Box>
        {status.workout.location && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted' }}>
            <LocationIcon size={14} />
            <Text sx={{ fontSize: 0 }}>{status.workout.location}</Text>
          </Box>
        )}
      </Box>
      <Text
        sx={{
          display: 'block',
          fontSize: 0,
          fontWeight: 'bold',
          mb: 1,
          color: state.key === 'concluded' ? 'fg.muted' : 'accent.fg',
        }}
      >
        {state.label}
      </Text>
      <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', mb: 2 }}>
        Organizado por {organizerUsername ? `@${organizerUsername}` : 'Membro'}
      </Text>
      {loadError && count === null ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Text sx={{ fontSize: 0, color: 'danger.fg' }}>
            Não foi possível carregar participantes.
          </Text>
          <Button size="small" onClick={() => setRetryToken((token) => token + 1)}>
            Tentar novamente
          </Button>
        </Box>
      ) : (
        <>
          <Box
            className="workout-participants-summary"
            sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', mb: 2 }}
          >
            {count !== null && (
              <Button
                size="small"
                variant="invisible"
                leadingVisual={PeopleIcon}
                sx={{ color: 'fg.muted', px: 1 }}
                onClick={() => setParticipantsOpen(true)}
              >
                {count} {count === 1 ? 'confirmado' : 'confirmados'} · Ver participantes
              </Button>
            )}
          </Box>
          <Box
            className="workout-actions"
            sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}
          >
            {(amParticipant || joinable) && (
              <Button
                size="small"
                variant={amParticipant ? 'default' : 'primary'}
                onClick={toggle}
                disabled={count === null || pending}
                leadingVisual={amParticipant ? PersonIcon : CheckIcon}
              >
                {amParticipant ? 'Cancelar participação' : 'Vou participar'}
              </Button>
            )}
            <Button size="small" leadingVisual={CalendarIcon} onClick={addToCalendar}>
              Adicionar ao calendário
            </Button>
          </Box>
        </>
      )}
      {participantsOpen && (
        <LazyDialogBoundary onFail={() => setParticipantsOpen(false)}>
          <WorkoutParticipantsDialog
            statusId={status.id}
            onClose={() => setParticipantsOpen(false)}
          />
        </LazyDialogBoundary>
      )}
    </Box>
  )
}

function StatusCardView({
  status,
  authorAvatarPath,
  currentUserId,
  canDelete,
  onDelete,
  now,
  showToast,
  myEconomyVote,
  onEconomyVoted,
  onPromoted,
  onEdited,
  communityName,
  canModerate = false,
  anchorPrefix = '',
  refreshEpoch = 0,
  onCommentCountChange,
}) {
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  // Sobrepõe o que esta edição já confirmou no servidor por cima do `status` do pai: o card
  // atualiza na hora, mesmo que o pai (lista do feed/Destaques) ainda não tenha repassado o
  // mesmo patch via onEdited -- nunca um refetch do feed inteiro só para refletir 1 edição.
  const [contentPatch, setContentPatch] = useState(null)
  const effectiveStatus = contentPatch ? { ...status, ...contentPatch } : status
  const isAuthor = status.authorId === currentUserId
  // Relógio compartilhado por seletor: só re-renderiza quando a promoção acaba ou a janela de
  // interação fecha (e `now` explícito, usado em testes, tem prioridade).
  const isCurrentlyPromoted = useNowSelector(
    now,
    (n) => Boolean(status.promoted) && toMillis(status.promotedUntil) > n,
    toMillis
  )
  const interactionActive = useNowSelector(
    now,
    (n) => isPublicationInteractionActive(status, n),
    toMillis
  )
  // Primeira entrega: só texto e legenda de foto são editáveis (ver StatusEditForm); enquete,
  // treino marcado e conquista continuam somente leitura. A janela de edição é a MESMA janela de
  // interação do post (comentar/votar) -- some sozinha quando a publicação expira, sem exigir um
  // clique que só terminaria em erro.
  const canEdit =
    isAuthor && (status.type === 'text' || status.type === 'photo') && interactionActive
  const handleCommentCount = useCallback(
    (delta) => onCommentCountChange?.(status.id, delta),
    [onCommentCountChange, status.id]
  )
  const handleEconomyVoted = useCallback(
    (value, delta) => onEconomyVoted?.(status.id, value, delta),
    [onEconomyVoted, status.id]
  )

  // Reagenda sempre que a mensagem muda (inclusive de um erro pro próximo): o cleanup
  // do efeito anterior cancela o timer velho antes deste rodar, então nunca há dois
  // timers concorrentes nem um timer antigo apagando uma mensagem mais nova.
  useEffect(() => {
    if (!actionError) return undefined
    const timer = window.setTimeout(() => setActionError(''), ACTION_ERROR_AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [actionError])

  function handleActionMessage(message, variant = 'success') {
    if (variant === 'danger') {
      setActionError(message)
      return
    }
    setActionError('')
    showToast?.(message, variant)
  }

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      const deleted = await onDelete(status)
      if (deleted !== false) setActionError('')
    } catch (error) {
      setActionError(error?.message || 'Não foi possível excluir a publicação.')
    } finally {
      setDeleting(false)
    }
  }

  function handleEditSaved(patch) {
    setContentPatch((previous) => ({ ...previous, ...patch }))
    setEditing(false)
    onEdited?.(status.id, patch)
  }

  return (
    <article
      className={`status-card${status.type === 'workout' ? ' workout-status-card' : ''}`}
      id={`${anchorPrefix}${status.type === 'workout' ? 'treino' : 'publicacao'}-${status.id}`}
    >
      <StatusHeader
        status={effectiveStatus}
        authorAvatarPath={authorAvatarPath}
        now={now}
        canDelete={canDelete}
        onDelete={handleDelete}
        deleting={deleting}
        canEdit={canEdit && !editing}
        onEdit={() => setEditing(true)}
        showToast={handleActionMessage}
      />

      {isCurrentlyPromoted && (
        <Box sx={{ mb: 2 }}>
          <PromotedBadge />
        </Box>
      )}

      <div className="status-content">
        {status.type === 'text' &&
          (editing ? (
            <StatusEditForm
              status={effectiveStatus}
              onCancel={() => setEditing(false)}
              onSaved={handleEditSaved}
            />
          ) : (
            <StatusText value={effectiveStatus.text} />
          ))}

        {status.type === 'achievement' && <AchievementSummary achievement={status.achievement} />}

        {status.type === 'poll' && (
          <PollStatus
            status={status}
            currentUserId={currentUserId}
            showToast={handleActionMessage}
            onActionSuccess={() => setActionError('')}
            interactionActive={interactionActive}
            refreshEpoch={refreshEpoch}
          />
        )}

        {status.type === 'workout' && (
          <WorkoutStatus
            status={status}
            currentUserId={currentUserId}
            showToast={handleActionMessage}
            onActionSuccess={() => setActionError('')}
            now={now}
            communityName={communityName}
            refreshEpoch={refreshEpoch}
          />
        )}

        {status.type === 'photo' && (
          <>
            <PhotoStatus
              status={effectiveStatus}
              preloadedBlob={status._localPhotoBlob}
              hideCaption={editing}
            />
            {editing && (
              <StatusEditForm
                status={effectiveStatus}
                onCancel={() => setEditing(false)}
                onSaved={handleEditSaved}
              />
            )}
          </>
        )}
      </div>
      {/* Enquete usa o voto gratuito das próprias opções; treino usa participação.
          Nenhum dos dois monta EconomyVoteBar ou seus contadores/listas. O backend usa
          a mesma elegibilidade em vote-service e no settlement de recompensas antigas. */}
      <div className="status-actions">
        {status.type !== 'poll' && status.type !== 'workout' && (
          <div className="status-footer">
            <EconomyVoteBar
              status={status}
              currentUserId={currentUserId}
              showToast={handleActionMessage}
              myVote={myEconomyVote}
              onVoted={handleEconomyVoted}
              onActionSuccess={() => setActionError('')}
              interactionActive={interactionActive}
            />
          </div>
        )}
        {COMMENTS_ENABLED && (
          <CommentSection
            statusId={status.id}
            communityId={status.communityId}
            initialCount={status.commentCount}
            currentUserId={currentUserId}
            canModerate={canModerate}
            allowWrite={interactionActive}
            onCountChange={handleCommentCount}
          />
        )}
      </div>
      {isReportableAuthor(status, currentUserId) && (
        <Link
          className="status-report-link"
          to={`/atendimento?tipo=report&publicacao=${encodeURIComponent(status.id)}&comunidade=${encodeURIComponent(status.communityId)}`}
        >
          Denunciar violação
        </Link>
      )}
      {isAuthor && !isCurrentlyPromoted && (
        <Button size="small" variant="invisible" onClick={() => setPromoteOpen(true)}>
          Promover publicação
        </Button>
      )}
      {promoteOpen && (
        <LazyDialogBoundary onFail={() => setPromoteOpen(false)}>
          <PromoteDialog
            targetType="post"
            targetId={status.id}
            currentUserId={currentUserId}
            title="Promover publicação"
            onClose={() => setPromoteOpen(false)}
            onPromoted={(result) => {
              setPromoteOpen(false)
              onPromoted?.(status.id, result)
            }}
          />
        </LazyDialogBoundary>
      )}
      {actionError && (
        <Flash className="status-action-error" variant="danger" role="alert">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Text sx={{ flex: 1, minWidth: 0 }}>{actionError}</Text>
            <IconButton
              icon={XIcon}
              variant="invisible"
              size="small"
              aria-label="Dispensar aviso"
              onClick={() => setActionError('')}
              sx={{ color: 'fg.muted', flexShrink: 0 }}
            />
          </Box>
        </Flash>
      )}
    </article>
  )
}

// memo: um voto/exclusão/atualização numa publicação não re-renderiza as outras do feed (os handlers
// recebidos do pai são estáveis e o relógio entra por seletor, não por props).
export const StatusCard = memo(StatusCardView)

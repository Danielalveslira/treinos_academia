import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Text, Button, Flash, IconButton } from '@primer/react'
import {
  TrashIcon,
  PersonIcon,
  LocationIcon,
  ClockIcon,
  ShieldCheckIcon,
  CheckIcon,
  CalendarIcon,
  PeopleIcon,
  XIcon,
} from '@primer/octicons-react'
import {
  getMyVote,
  getPollResults,
  voteOnPoll,
  amIParticipant,
  countParticipants,
  joinWorkout,
  leaveWorkout,
} from '../services/statusesService'
import { ExpiryBadge } from './ExpiryBadge'
import { EconomyVoteBar } from './EconomyVoteBar'
import { AchievementSummary } from './AchievementSummary'
import { MarkdownViewer } from './MarkdownViewer'
import { PhotoStatus } from './PhotoStatus'
import { ProfileAvatar } from './ProfileAvatar'
import { ShareMenu } from './ShareMenu'
import { PromoteDialog } from './PromoteDialog'
import { PromotedBadge } from './PromotedBadge'
import { WorkoutParticipantsDialog } from './WorkoutParticipantsDialog'
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
import '../styles/workout-status.css'

// Todo erro contextual hoje é transitório (voto, enquete, participação, exclusão --
// sempre resolve tentando de novo), então some sozinho depois de um tempo pra não virar
// lixo visual acumulado no card. O X abaixo cobre o caso de alguém querer descartar
// antes disso.
const ACTION_ERROR_AUTO_DISMISS_MS = 6000

// Selo dourado e discreto — o valor vem de authorIsSuperAdmin, gravado no status pelo
// trigger enforce_status_author_badge no momento da publicação (ver
// statusesService.js), nunca de um campo que o próprio cliente poderia forjar.
function SuperAdminBadge() {
  return (
    <Box
      as="span"
      title="Superadmin"
      aria-label="Superadmin"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        color: 'attention.fg',
      }}
    >
      <ShieldCheckIcon size={14} />
    </Box>
  )
}

function StatusHeader({ status, authorAvatarPath, now, canDelete, onDelete, deleting, showToast }) {
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
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Link to={`/comunidades/perfil/${status.authorId}`} className="status-author">
            {authorUsername ? `@${authorUsername}` : 'Membro'}
          </Link>
          {status.authorIsSuperAdmin && <SuperAdminBadge />}
        </Box>
        <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
          {formatDateTime(toDate(status.createdAt))}
        </Text>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 1 }}>
        <ExpiryBadge status={status} now={now} />
        <ShareMenu status={status} showToast={showToast} />
        {canDelete && (
          <IconButton
            icon={TrashIcon}
            variant="invisible"
            size="small"
            aria-label="Excluir publicação"
            onClick={() => onDelete(status)}
            disabled={deleting}
            sx={{ color: 'fg.muted' }}
          />
        )}
      </Box>
    </header>
  )
}

function PollStatus({ status, currentUserId, showToast, onActionSuccess, interactionActive }) {
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
  // O constraint statuses_content_shape só valida a quantidade de opções (2 a 6), não o
  // shape de cada item -- então, mesmo raciocínio do authorUsername acima: um item
  // inesperado (ex.: null) não deveria quebrar a renderização de toda a enquete, só ser
  // ignorado.
  const options = (status.poll?.options || []).filter(
    (option) => option && typeof option.id === 'string' && typeof option.label === 'string'
  )
  const optionIds = options.map((option) => option.id)

  useEffect(() => {
    if (cached) return
    let active = true
    setLoadError(false)
    Promise.all([getPollResults(status.id, optionIds), getMyVote(status.id, currentUserId)])
      .then(([results, myVote]) => {
        if (!active) return
        const myOptionId = myVote?.optionId ?? null
        setCounts(results)
        setMyOptionId(myOptionId)
        setCached(cacheKey, { counts: results, myOptionId })
      })
      .catch((error) => {
        if (!active) return
        console.error('[PollStatus] getPollResults/getMyVote:', error)
        setLoadError(true)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.id, currentUserId, retryToken])

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

  return (
    <Box>
      <Text sx={{ fontWeight: 'bold', fontSize: 1, display: 'block', mb: 2 }}>
        {status.poll?.question}
      </Text>
      <Box sx={{ display: 'grid', gap: 2 }}>
        {options.map((option) => {
          const count = counts?.[option.id] || 0
          const percent = total > 0 ? Math.round((count / total) * 100) : 0
          const isMine = myOptionId === option.id
          return (
            <Box
              key={option.id}
              as={counts && !myOptionId && interactionActive ? 'button' : 'div'}
              type={counts && !myOptionId && interactionActive ? 'button' : undefined}
              disabled={counts && !myOptionId && interactionActive ? voting : undefined}
              onClick={
                counts && !myOptionId && interactionActive ? () => handleVote(option.id) : undefined
              }
              sx={{
                position: 'relative',
                textAlign: 'left',
                border: '1px solid',
                borderColor: isMine ? 'accent.emphasis' : 'border.default',
                borderRadius: 2,
                minHeight: 40,
                p: 2,
                bg: 'canvas.default',
                color: 'fg.default',
                cursor:
                  counts && !myOptionId && interactionActive && !voting ? 'pointer' : 'default',
                overflow: 'hidden',
              }}
            >
              {counts && (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    width: `${percent}%`,
                    bg: 'accent.subtle',
                    zIndex: 0,
                  }}
                />
              )}
              <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'space-between' }}>
                <Text sx={{ fontSize: 0 }}>{option.label}</Text>
                {counts && (
                  <Text sx={{ fontSize: 0, color: 'fg.muted', flexShrink: 0, ml: 2 }}>
                    {percent}% ({count})
                  </Text>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
      {counts && (
        <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mt: 2 }}>
          {total} {total === 1 ? 'voto' : 'votos'}
        </Text>
      )}
    </Box>
  )
}

// Treino Marcado V1: identidade própria (título, estado temporal calculado a partir de
// workout.date -- nunca de expiresAt, ver utils/scheduledWorkout.js), organizador,
// participação e "Adicionar ao calendário". `now` vem do relógio já compartilhado pelo
// feed (useCommunityFeed.js, atualizado a cada 15s) -- nenhum setInterval novo só para
// este card.
function WorkoutStatus({ status, currentUserId, showToast, onActionSuccess, now, communityName }) {
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

  useEffect(() => {
    if (cached) return
    let active = true
    setLoadError(false)
    Promise.all([countParticipants(status.id), amIParticipant(status.id, currentUserId)])
      .then(([total, mine]) => {
        if (!active) return
        setCount(total)
        setAmParticipant(mine)
        setCached(cacheKey, { count: total, amParticipant: mine })
      })
      .catch((error) => {
        if (!active) return
        console.error('[WorkoutStatus] countParticipants/amIParticipant:', error)
        setLoadError(true)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.id, currentUserId, retryToken])

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
  const nowMs = toMillis(now) || Date.now()
  const state = describeScheduledWorkoutState(dateMs, nowMs)
  const joinable = isScheduledWorkoutJoinable(dateMs, nowMs)
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
        <WorkoutParticipantsDialog
          statusId={status.id}
          onClose={() => setParticipantsOpen(false)}
        />
      )}
    </Box>
  )
}

export function StatusCard({
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
  communityName,
}) {
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const isAuthor = status.authorId === currentUserId
  const isCurrentlyPromoted =
    Boolean(status.promoted) && toMillis(status.promotedUntil) > toMillis(now)
  const interactionActive = isPublicationInteractionActive(status, now)

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

  return (
    <article
      className={`status-card${status.type === 'workout' ? ' workout-status-card' : ''}`}
      id={status.type === 'workout' ? `treino-${status.id}` : undefined}
    >
      <StatusHeader
        status={status}
        authorAvatarPath={authorAvatarPath}
        now={now}
        canDelete={canDelete}
        onDelete={handleDelete}
        deleting={deleting}
        showToast={handleActionMessage}
      />

      {isCurrentlyPromoted && (
        <Box sx={{ mb: 2 }}>
          <PromotedBadge />
        </Box>
      )}

      <div className="status-content">
        {status.type === 'text' && <MarkdownViewer value={status.text} />}

        {status.type === 'achievement' && <AchievementSummary achievement={status.achievement} />}

        {status.type === 'poll' && (
          <PollStatus
            status={status}
            currentUserId={currentUserId}
            showToast={handleActionMessage}
            onActionSuccess={() => setActionError('')}
            interactionActive={interactionActive}
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
          />
        )}

        {status.type === 'photo' && (
          <PhotoStatus status={status} preloadedBlob={status._localPhotoBlob} />
        )}
      </div>
      {/* Enquete usa o voto gratuito das próprias opções; treino usa participação.
          Nenhum dos dois monta EconomyVoteBar ou seus contadores/listas. O backend usa
          a mesma elegibilidade em vote-service e no settlement de recompensas antigas. */}
      {status.type !== 'poll' && status.type !== 'workout' && (
        <div className="status-footer">
          <EconomyVoteBar
            status={status}
            currentUserId={currentUserId}
            showToast={handleActionMessage}
            myVote={myEconomyVote}
            onVoted={onEconomyVoted}
            onActionSuccess={() => setActionError('')}
            interactionActive={interactionActive}
          />
        </div>
      )}
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

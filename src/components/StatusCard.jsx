import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Text, Button, IconButton } from '@primer/react'
import {
  TrashIcon,
  PersonIcon,
  LocationIcon,
  ClockIcon,
  ShieldCheckIcon,
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
import { AchievementSummary } from './AchievementSummary'
import { MarkdownViewer } from './MarkdownViewer'
import { PhotoStatus } from './PhotoStatus'
import { ShareMenu } from './ShareMenu'
import { formatDateTime } from '../utils/format'
import { getCached, setCached } from '../utils/pageCache'
import { isReportableAuthor } from '../utils/moderation'

function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value)
}

// Selo dourado e discreto — o valor vem de authorIsSuperAdmin, gravado no status e
// conferido pelo servidor no momento da publicação (ver firestore.rules e
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

function StatusHeader({ status, now, canDelete, onDelete, showToast }) {
  // As regras exigem authorUsername nulo ou string (ver firestore.rules), mas nunca
  // custa nada tratar dado inesperado com cuidado aqui também — um valor de outro
  // tipo (ex.: number) não deveria derrubar o card inteiro, só cair no "M" padrão.
  const authorUsername = typeof status.authorUsername === 'string' ? status.authorUsername : null
  const initial = (authorUsername || 'M').charAt(0).toUpperCase() || 'M'
  return (
    <header className="status-header">
      <Box
        aria-hidden="true"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: '50%',
          bg: 'canvas.subtle',
          color: 'fg.muted',
          fontSize: 1,
          fontWeight: 'bold',
        }}
      >
        {initial}
      </Box>
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
        <ExpiryBadge expiresAt={status.expiresAt} now={now} />
        <ShareMenu status={status} showToast={showToast} />
        {canDelete && (
          <IconButton
            icon={TrashIcon}
            variant="invisible"
            size="small"
            aria-label="Excluir publicação"
            onClick={() => onDelete(status)}
            sx={{ color: 'fg.muted' }}
          />
        )}
      </Box>
    </header>
  )
}

function PollStatus({ status, currentUserId }) {
  // counts/myOptionId em vez da lista de votos: nunca baixa a subcoleção inteira (uma
  // enquete popular pode ter milhares de votos) — só contagens agregadas por opção
  // (no máximo 6, teto do schema) e o meu próprio voto, 1 leitura direta pelo id.
  const cacheKey = `pollStatus:${status.id}:${currentUserId}`
  const cached = getCached(cacheKey)
  const [counts, setCounts] = useState(cached?.counts ?? null)
  const [myOptionId, setMyOptionId] = useState(cached?.myOptionId ?? null)
  const [voting, setVoting] = useState(false)
  // As regras exigem que cada opção seja {id, label} (ver firestore.rules), mas o
  // mesmo raciocínio do authorUsername acima vale aqui: um item inesperado (ex.:
  // null) não deveria quebrar a renderização de toda a enquete, só ser ignorado.
  const options = (status.poll?.options || []).filter(
    (option) => option && typeof option.id === 'string' && typeof option.label === 'string'
  )
  const optionIds = options.map((option) => option.id)

  useEffect(() => {
    if (cached) return
    let active = true
    Promise.all([getPollResults(status.id, optionIds), getMyVote(status.id, currentUserId)]).then(
      ([results, myVote]) => {
        if (!active) return
        const myOptionId = myVote?.optionId ?? null
        setCounts(results)
        setMyOptionId(myOptionId)
        setCached(cacheKey, { counts: results, myOptionId })
      }
    )
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.id, currentUserId])

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
    } finally {
      setVoting(false)
    }
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
              as={counts && !myOptionId ? 'button' : 'div'}
              type={counts && !myOptionId ? 'button' : undefined}
              onClick={counts && !myOptionId ? () => handleVote(option.id) : undefined}
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
                cursor: counts && !myOptionId ? 'pointer' : 'default',
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

function WorkoutStatus({ status, currentUserId }) {
  // Contagem agregada + 1 leitura direta pelo id (não a lista inteira de participantes)
  // — mesmo raciocínio da enquete: nunca escala com o número de pessoas confirmadas.
  const cacheKey = `workoutStatus:${status.id}:${currentUserId}`
  const cached = getCached(cacheKey)
  const [count, setCount] = useState(cached?.count ?? null)
  const [amParticipant, setAmParticipant] = useState(cached?.amParticipant ?? false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (cached) return
    let active = true
    Promise.all([countParticipants(status.id), amIParticipant(status.id, currentUserId)]).then(
      ([total, mine]) => {
        if (!active) return
        setCount(total)
        setAmParticipant(mine)
        setCached(cacheKey, { count: total, amParticipant: mine })
      }
    )
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.id, currentUserId])

  async function toggle() {
    setPending(true)
    try {
      if (amParticipant) {
        await leaveWorkout(status.id, currentUserId)
        setCount((prev) => {
          const next = prev - 1
          setCached(cacheKey, { count: next, amParticipant: false })
          return next
        })
        setAmParticipant(false)
      } else {
        await joinWorkout(status.id, currentUserId)
        setCount((prev) => {
          const next = prev + 1
          setCached(cacheKey, { count: next, amParticipant: true })
          return next
        })
        setAmParticipant(true)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Box>
      <Text sx={{ fontWeight: 'bold', fontSize: 1, display: 'block', mb: 2 }}>
        {status.workout.title}
      </Text>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted' }}>
          <ClockIcon size={14} />
          <Text sx={{ fontSize: 0 }}>{formatDateTime(toDate(status.workout.date))}</Text>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted' }}>
          <LocationIcon size={14} />
          <Text sx={{ fontSize: 0 }}>{status.workout.location}</Text>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant={amParticipant ? 'default' : 'primary'}
          onClick={toggle}
          disabled={count === null || pending}
          leadingVisual={PersonIcon}
        >
          {amParticipant ? 'Cancelar participação' : 'Participar'}
        </Button>
        {count !== null && (
          <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
            {count} {count === 1 ? 'confirmado' : 'confirmados'}
          </Text>
        )}
      </Box>
    </Box>
  )
}

export function StatusCard({ status, currentUserId, canDelete, onDelete, now, showToast }) {
  return (
    <article className="status-card">
      <StatusHeader
        status={status}
        now={now}
        canDelete={canDelete}
        onDelete={onDelete}
        showToast={showToast}
      />

      <div className="status-content">
        {status.type === 'text' && <MarkdownViewer value={status.text} />}

        {status.type === 'achievement' && <AchievementSummary achievement={status.achievement} />}

        {status.type === 'poll' && <PollStatus status={status} currentUserId={currentUserId} />}

        {status.type === 'workout' && (
          <WorkoutStatus status={status} currentUserId={currentUserId} />
        )}

        {status.type === 'photo' && (
          <PhotoStatus status={status} preloadedBlob={status._localPhotoBlob} />
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
    </article>
  )
}

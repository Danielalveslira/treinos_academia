import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Text, Button, IconButton } from '@primer/react'
import { TrashIcon, PersonIcon, LocationIcon, ClockIcon } from '@primer/octicons-react'
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
import { formatDateTime } from '../utils/format'

function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value)
}

function StatusHeader({ status, now, canDelete, onDelete }) {
  const initial = (status.authorUsername || 'M')[0].toUpperCase()
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
        <Link to={`/comunidades/perfil/${status.authorId}`} className="status-author">
          {status.authorUsername ? `@${status.authorUsername}` : 'Membro'}
        </Link>
        <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
          {formatDateTime(toDate(status.createdAt))}
        </Text>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 1 }}>
        <ExpiryBadge expiresAt={status.expiresAt} now={now} />
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
  const [counts, setCounts] = useState(null)
  const [myOptionId, setMyOptionId] = useState(null)
  const [voting, setVoting] = useState(false)
  const optionIds = status.poll.options.map((option) => option.id)

  useEffect(() => {
    let active = true
    Promise.all([getPollResults(status.id, optionIds), getMyVote(status.id, currentUserId)]).then(
      ([results, myVote]) => {
        if (!active) return
        setCounts(results)
        setMyOptionId(myVote?.optionId ?? null)
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
      setCounts((prev) => ({ ...prev, [optionId]: (prev?.[optionId] || 0) + 1 }))
      setMyOptionId(optionId)
    } finally {
      setVoting(false)
    }
  }

  return (
    <Box>
      <Text sx={{ fontWeight: 'bold', fontSize: 1, display: 'block', mb: 2 }}>
        {status.poll.question}
      </Text>
      <Box sx={{ display: 'grid', gap: 2 }}>
        {status.poll.options.map((option) => {
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
  const [count, setCount] = useState(null)
  const [amParticipant, setAmParticipant] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([countParticipants(status.id), amIParticipant(status.id, currentUserId)]).then(
      ([total, mine]) => {
        if (!active) return
        setCount(total)
        setAmParticipant(mine)
      }
    )
    return () => {
      active = false
    }
  }, [status.id, currentUserId])

  async function toggle() {
    setPending(true)
    try {
      if (amParticipant) {
        await leaveWorkout(status.id, currentUserId)
        setCount((prev) => prev - 1)
        setAmParticipant(false)
      } else {
        await joinWorkout(status.id, currentUserId)
        setCount((prev) => prev + 1)
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

export function StatusCard({ status, currentUserId, canDelete, onDelete, now }) {
  return (
    <article className="status-card">
      <StatusHeader status={status} now={now} canDelete={canDelete} onDelete={onDelete} />

      <div className="status-content">
        {status.type === 'text' && <MarkdownViewer value={status.text} />}

        {status.type === 'achievement' && <AchievementSummary achievement={status.achievement} />}

        {status.type === 'poll' && <PollStatus status={status} currentUserId={currentUserId} />}

        {status.type === 'workout' && (
          <WorkoutStatus status={status} currentUserId={currentUserId} />
        )}
      </div>
      <Link
        className="status-report-link"
        to={`/atendimento?tipo=report&publicacao=${encodeURIComponent(status.id)}&comunidade=${encodeURIComponent(status.communityId)}`}
      >
        Denunciar violação
      </Link>
    </article>
  )
}

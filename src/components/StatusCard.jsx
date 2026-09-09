import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Text, Button, IconButton } from '@primer/react'
import { TrashIcon, PersonIcon, LocationIcon, ClockIcon } from '@primer/octicons-react'
import {
  listVotes,
  voteOnPoll,
  listParticipants,
  joinWorkout,
  leaveWorkout,
} from '../services/statusesService'
import { formatDate, formatDateTime } from '../utils/format'

function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value)
}

function AuthorLine({ status, canDelete, onDelete }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
      <Box sx={{ minWidth: 0 }}>
        <Link className="community-author-link" to={`/comunidades/perfil/${status.authorId}`}>
          {status.authorUsername ? `@${status.authorUsername}` : 'Membro'}
        </Link>
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
          {formatDateTime(toDate(status.createdAt))}
        </Text>
      </Box>
      {canDelete && (
        <IconButton
          icon={TrashIcon}
          variant="invisible"
          aria-label="Excluir publicação"
          onClick={() => onDelete(status)}
          sx={{ color: 'fg.muted', flexShrink: 0 }}
        />
      )}
    </Box>
  )
}

function PollStatus({ status, currentUserId }) {
  const [votes, setVotes] = useState(null)
  const [voting, setVoting] = useState(false)

  useEffect(() => {
    let active = true
    listVotes(status.id).then((data) => {
      if (active) setVotes(data)
    })
    return () => {
      active = false
    }
  }, [status.id])

  const myVote = votes?.find((v) => v.userId === currentUserId)
  const total = votes?.length || 0

  async function handleVote(optionId) {
    if (myVote || voting) return
    setVoting(true)
    try {
      await voteOnPoll(status.id, currentUserId, optionId)
      setVotes((prev) => [...(prev || []), { userId: currentUserId, optionId }])
    } finally {
      setVoting(false)
    }
  }

  return (
    <Box>
      <Text sx={{ fontWeight: 'bold', display: 'block', mb: 2 }}>{status.poll.question}</Text>
      <Box sx={{ display: 'grid', gap: 2 }}>
        {status.poll.options.map((option) => {
          const count = votes?.filter((v) => v.optionId === option.id).length || 0
          const percent = total > 0 ? Math.round((count / total) * 100) : 0
          const isMine = myVote?.optionId === option.id
          return (
            <Box
              key={option.id}
              as={votes && !myVote ? 'button' : 'div'}
              type={votes && !myVote ? 'button' : undefined}
              onClick={votes && !myVote ? () => handleVote(option.id) : undefined}
              sx={{
                position: 'relative',
                textAlign: 'left',
                border: '1px solid',
                borderColor: isMine ? 'accent.emphasis' : 'border.default',
                borderRadius: 2,
                p: 2,
                bg: 'canvas.default',
                cursor: votes && !myVote ? 'pointer' : 'default',
                overflow: 'hidden',
              }}
            >
              {votes && (
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
                <Text sx={{ fontSize: 1 }}>{option.label}</Text>
                {votes && (
                  <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                    {percent}% ({count})
                  </Text>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
      {votes && (
        <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mt: 2 }}>
          {total} {total === 1 ? 'voto' : 'votos'}
        </Text>
      )}
    </Box>
  )
}

function WorkoutStatus({ status, currentUserId }) {
  const [participants, setParticipants] = useState(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    listParticipants(status.id).then((data) => {
      if (active) setParticipants(data)
    })
    return () => {
      active = false
    }
  }, [status.id])

  const amParticipant = participants?.some((p) => p.userId === currentUserId)

  async function toggle() {
    setPending(true)
    try {
      if (amParticipant) {
        await leaveWorkout(status.id, currentUserId)
        setParticipants((prev) => prev.filter((p) => p.userId !== currentUserId))
      } else {
        await joinWorkout(status.id, currentUserId)
        setParticipants((prev) => [...(prev || []), { userId: currentUserId }])
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Box>
      <Text sx={{ fontWeight: 'bold', display: 'block', mb: 2 }}>{status.workout.title}</Text>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <ClockIcon size={14} />
          <Text sx={{ fontSize: 1 }}>{formatDateTime(toDate(status.workout.date))}</Text>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <LocationIcon size={14} />
          <Text sx={{ fontSize: 1 }}>{status.workout.location}</Text>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <Button
          size="small"
          variant={amParticipant ? 'default' : 'primary'}
          onClick={toggle}
          disabled={!participants || pending}
          leadingVisual={PersonIcon}
        >
          {amParticipant ? 'Cancelar participação' : 'Participar'}
        </Button>
        {participants && (
          <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
            {participants.length} {participants.length === 1 ? 'confirmado' : 'confirmados'}
          </Text>
        )}
      </Box>
    </Box>
  )
}

export function StatusCard({ status, currentUserId, canDelete, onDelete }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        mb: 3,
      }}
    >
      <AuthorLine status={status} canDelete={canDelete} onDelete={onDelete} />

      {status.type === 'text' && <Text sx={{ whiteSpace: 'pre-wrap' }}>{status.text}</Text>}

      {status.type === 'achievement' && (
        <section className="achievement-card">
          <span className="profile-eyebrow">CONQUISTA DO DIA</span>
          <h3>{formatDate(new Date(`${status.achievement.day}T12:00:00`))}</h3>
          {status.achievement.text && <p>{status.achievement.text}</p>}
          <div className="achievement-totals">
            <span>
              <strong>{status.achievement.entries}</strong> registros de exercícios
            </span>
            <span>
              <strong>{status.achievement.sets}</strong> séries realizadas
            </span>
          </div>
        </section>
      )}

      {status.type === 'poll' && <PollStatus status={status} currentUserId={currentUserId} />}

      {status.type === 'workout' && <WorkoutStatus status={status} currentUserId={currentUserId} />}
    </Box>
  )
}

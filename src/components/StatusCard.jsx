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
import { ExpiryBadge } from './ExpiryBadge'
import { AchievementSummary } from './AchievementSummary'
import { formatDateTime } from '../utils/format'

function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value)
}

function StatusHeader({ status, now, canDelete, onDelete }) {
  const initial = (status.authorUsername || 'M')[0].toUpperCase()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
      <Box
        aria-hidden="true"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: '10px',
          bg: 'accent.emphasis',
          color: 'fg.onEmphasis',
          fontSize: 1,
          fontWeight: 'bold',
        }}
      >
        {initial}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Link
          to={`/comunidades/perfil/${status.authorId}`}
          style={{ display: 'block', fontWeight: 600, fontSize: 14, overflowWrap: 'anywhere' }}
        >
          {status.authorUsername ? `@${status.authorUsername}` : 'Membro'}
        </Link>
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
          {formatDateTime(toDate(status.createdAt))}
        </Text>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
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
      <Text sx={{ fontWeight: 'bold', fontSize: 1, display: 'block', mb: 2 }}>
        {status.poll.question}
      </Text>
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
                minHeight: 40,
                p: 2,
                bg: 'canvas.default',
                color: 'fg.default',
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
                <Text sx={{ fontSize: 0 }}>{option.label}</Text>
                {votes && (
                  <Text sx={{ fontSize: 0, color: 'fg.muted', flexShrink: 0, ml: 2 }}>
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

export function StatusCard({ status, currentUserId, canDelete, onDelete, now }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        mb: 3,
        '&:hover': { bg: 'canvas.subtle' },
      }}
    >
      <StatusHeader status={status} now={now} canDelete={canDelete} onDelete={onDelete} />

      <Box sx={{ pl: [0, '44px'] }}>
        {status.type === 'text' && (
          <Text sx={{ fontSize: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {status.text}
          </Text>
        )}

        {status.type === 'achievement' && <AchievementSummary achievement={status.achievement} />}

        {status.type === 'poll' && <PollStatus status={status} currentUserId={currentUserId} />}

        {status.type === 'workout' && (
          <WorkoutStatus status={status} currentUserId={currentUserId} />
        )}
      </Box>
    </Box>
  )
}

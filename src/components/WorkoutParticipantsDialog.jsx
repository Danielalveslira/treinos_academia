import { useEffect, useReducer } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Dialog, Link, Spinner, Text } from '@primer/react'
import { listWorkoutParticipants } from '../services/statusesService'
import {
  initialParticipantsDialogState,
  participantsDialogReducer,
} from '../utils/workoutParticipantsState'

// "Ver participantes" (Treino Marcado V1) -- mesmo desenho de EconomyVotersDialog.jsx
// (reducer puro sem I/O, corpo sem <Dialog>/Portal separado do wrapper fino): igual lá,
// react-test-renderer trava a saída do processo de teste neste projeto quando a árvore
// mistura react-router-dom/interatividade real, então a lógica de paginação é testada
// aqui, pura, sem simular clique nenhum -- ver WorkoutParticipantsDialog.test.js. Nunca
// lê statuses/{id}/participants direto nem users/{uid} (Rules já bloqueiam para outro
// usuário) -- só dados públicos sanitizados pela callable dedicada.
export function ParticipantRow({ participant }) {
  const initial = (participant.username || 'M').charAt(0).toUpperCase()
  return (
    <Box
      className="workout-participant-row"
      sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}
    >
      <Box
        aria-hidden="true"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: '50%',
          bg: 'canvas.subtle',
          color: 'fg.muted',
          fontSize: 0,
          fontWeight: 'bold',
        }}
      >
        {initial}
      </Box>
      <Link
        className="workout-participant-link"
        as={RouterLink}
        to={`/comunidades/perfil/${participant.userId}`}
      >
        {participant.username ? `@${participant.username}` : 'Membro'}
      </Link>
    </Box>
  )
}

export function WorkoutParticipantsDialogBody({ statusId }) {
  const [state, dispatch] = useReducer(
    participantsDialogReducer,
    undefined,
    initialParticipantsDialogState
  )
  const { participants, cursor, loaded, loading, error } = state

  async function loadPage({ reset = false } = {}) {
    dispatch({ type: 'load_start' })
    try {
      const result = await listWorkoutParticipants(statusId, { cursor: reset ? null : cursor })
      dispatch({
        type: 'load_success',
        participants: result.participants,
        nextCursor: result.nextCursor,
        reset,
      })
    } catch (err) {
      console.error('[WorkoutParticipantsDialog] load:', err)
      dispatch({
        type: 'load_error',
        message: 'Não foi possível carregar a lista. Tente novamente.',
      })
    }
  }

  useEffect(() => {
    if (!loaded) loadPage({ reset: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasMore = cursor != null

  return (
    <>
      {error && (
        <Text as="p" role="alert" sx={{ color: 'danger.fg', fontSize: 0, mb: 0 }}>
          {error}
        </Text>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        {participants.map((participant) => (
          <ParticipantRow key={participant.userId} participant={participant} />
        ))}
        {!loading && loaded && participants.length === 0 && !error && (
          <Text sx={{ color: 'fg.muted', fontSize: 0 }}>Ninguém confirmou presença ainda.</Text>
        )}
      </Box>

      {loading && <Spinner aria-label="Carregando" sx={{ mt: 3 }} />}
      {hasMore && !loading && (
        <Button sx={{ mt: 3 }} block onClick={() => loadPage()}>
          Carregar mais
        </Button>
      )}
    </>
  )
}

export function WorkoutParticipantsDialog({ statusId, onClose }) {
  return (
    <Dialog title="Quem vai participar" onClose={onClose} width="medium">
      <WorkoutParticipantsDialogBody statusId={statusId} />
    </Dialog>
  )
}

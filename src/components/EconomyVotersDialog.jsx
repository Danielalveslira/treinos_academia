import { useEffect, useReducer } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Dialog, Link, Spinner, Text } from '@primer/react'
import { listPostEconomyVoters } from '../services/economyService'

// "Ver quem votou" -- modal com abas Apoios/Negativos, cada uma paginada
// independentemente (ver listPostEconomyVoters/economyService.js). Nunca lê
// statuses/{id}/economyVotes direto (Rules já bloqueiam -- ver firestore.rules); só
// dados públicos sanitizados pela callable dedicada. Cada aba guarda seu próprio
// cursor/lista -- trocar de aba e voltar não perde o progresso já carregado nem
// refaz a primeira página à toa.
export function VoterRow({ voter }) {
  const initial = (voter.username || 'M').charAt(0).toUpperCase()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>
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
      <Link as={RouterLink} to={`/comunidades/perfil/${voter.userId}`}>
        {voter.username ? `@${voter.username}` : 'Membro'}
      </Link>
    </Box>
  )
}

// Estado/transições extraídos como reducer puro (sem I/O, sem React) de propósito:
// react-test-renderer (act()/TestRenderer.create) trava a saída do processo de teste
// neste projeto sempre que a árvore inclui react-router-dom OU SegmentedControl
// (investigado a fundo -- não é plugin do esbuild, não é o próprio react-router-dom
// per se, é especificamente a combinação com o renderer interativo; renderToStaticMarkup
// sozinho nunca trava). Testar a transição de estado aqui, puro, cobre "clique troca de
// aba"/"paginação acrescenta"/"trocar e voltar preserva o que já carregou" sem precisar
// simular clique nenhum -- ver EconomyVotersDialog.test.js.
export function initialVotersDialogState(initialDirection) {
  return {
    direction: initialDirection,
    votersByDirection: { positive: [], negative: [] },
    cursorByDirection: { positive: null, negative: null },
    loadedByDirection: { positive: false, negative: false },
    loading: false,
    error: '',
  }
}

export function votersDialogReducer(state, action) {
  switch (action.type) {
    case 'switch':
      return { ...state, direction: action.direction }
    case 'load_start':
      return { ...state, loading: true, error: '' }
    case 'load_success':
      return {
        ...state,
        loading: false,
        votersByDirection: {
          ...state.votersByDirection,
          [action.direction]: action.reset
            ? action.voters
            : [...state.votersByDirection[action.direction], ...action.voters],
        },
        cursorByDirection: { ...state.cursorByDirection, [action.direction]: action.nextCursor },
        loadedByDirection: { ...state.loadedByDirection, [action.direction]: true },
      }
    case 'load_error':
      return { ...state, loading: false, error: action.message }
    default:
      return state
  }
}

// Conteúdo puro (sem <Dialog>/Portal do Primer) -- extraído assim de propósito: o
// Portal do Dialog exige um document real (jsdom), que este projeto deliberadamente
// não usa em teste (só react-test-renderer/renderToStaticMarkup, ver CashPackageCards.
// test.js e outros). Isolar a lógica aqui permite testar sem precisar de jsdom; o
// <Dialog> em si (EconomyVotersDialog abaixo) é só um wrapper fino.
export function EconomyVotersDialogBody({ statusId, initialDirection, positiveCount, negativeCount }) {
  const [state, dispatch] = useReducer(votersDialogReducer, initialDirection, initialVotersDialogState)
  const { direction, votersByDirection, cursorByDirection, loadedByDirection, loading, error } = state

  async function loadPage(targetDirection, { reset = false } = {}) {
    dispatch({ type: 'load_start' })
    try {
      const cursor = reset ? null : cursorByDirection[targetDirection]
      const result = await listPostEconomyVoters(statusId, targetDirection, { cursor })
      dispatch({
        type: 'load_success',
        direction: targetDirection,
        voters: result.voters,
        nextCursor: result.nextCursor,
        reset,
      })
    } catch (err) {
      console.error('[EconomyVotersDialog] load:', err)
      dispatch({ type: 'load_error', message: 'Não foi possível carregar a lista. Tente novamente.' })
    }
  }

  useEffect(() => {
    if (!loadedByDirection[direction]) loadPage(direction, { reset: true })
    // Só dispara quando a aba muda para uma direção ainda não carregada -- loadPage é
    // recriada a cada render, mas não deve refazer a carga já feita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction])

  const voters = votersByDirection[direction]
  const hasMore = cursorByDirection[direction] != null
  const emptyMessage = direction === 'positive' ? 'Ninguém apoiou ainda.' : 'Ninguém votou negativo ainda.'

  return (
    <>
      <Box role="tablist" aria-label="Direção do voto" sx={{ display: 'flex', gap: 1 }}>
        <Button
          role="tab"
          aria-selected={direction === 'positive'}
          size="small"
          variant={direction === 'positive' ? 'primary' : 'default'}
          onClick={() => dispatch({ type: 'switch', direction: 'positive' })}
        >
          Apoios ({positiveCount})
        </Button>
        <Button
          role="tab"
          aria-selected={direction === 'negative'}
          size="small"
          variant={direction === 'negative' ? 'primary' : 'default'}
          onClick={() => dispatch({ type: 'switch', direction: 'negative' })}
        >
          Negativos ({negativeCount})
        </Button>
      </Box>

      {error && (
        <Text as="p" role="alert" sx={{ color: 'danger.fg', fontSize: 0, mt: 3, mb: 0 }}>
          {error}
        </Text>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', mt: 3 }}>
        {voters.map((voter) => (
          <VoterRow key={voter.userId} voter={voter} />
        ))}
        {!loading && loadedByDirection[direction] && voters.length === 0 && !error && (
          <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{emptyMessage}</Text>
        )}
      </Box>

      {loading && <Spinner aria-label="Carregando" sx={{ mt: 3 }} />}
      {hasMore && !loading && (
        <Button sx={{ mt: 3 }} block onClick={() => loadPage(direction)}>
          Carregar mais
        </Button>
      )}
    </>
  )
}

export function EconomyVotersDialog({ statusId, initialDirection, positiveCount, negativeCount, onClose }) {
  return (
    <Dialog title="Quem votou" subtitle="Votos econômicos -- não são anônimos" onClose={onClose} width="medium">
      <EconomyVotersDialogBody
        statusId={statusId}
        initialDirection={initialDirection}
        positiveCount={positiveCount}
        negativeCount={negativeCount}
      />
    </Dialog>
  )
}

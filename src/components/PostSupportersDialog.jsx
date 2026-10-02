import { useEffect, useReducer } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Dialog, Link, Spinner, Text } from '@primer/react'
import { listPostSupporters } from '../services/economyService'

// "Quem curtiu" -- modal só de quem CURTIU (apoio), paginado. Quem reagiu negativamente NUNCA aparece
// (nem existe no backend uma RPC que liste essas pessoas -- ver list_post_supporters e a
// migration 20261006000001). Só é montado quando o usuário abre o modal, então o feed nunca
// carrega usuários junto com as publicações. Nunca lê status_economy_votes direto (RLS só
// libera o próprio voto); os dados vêm sanitizados da RPC, mínimos: { userId, username }. A lista é só
// texto (@usuario, com link para o perfil público): sem avatar, placeholder nem espaço de imagem.
export function SupporterRow({ supporter }) {
  const label = supporter.username ? `@${supporter.username}` : 'Membro'
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', py: 1, minWidth: 0 }}>
      <Link
        as={RouterLink}
        to={`/comunidades/perfil/${supporter.userId}`}
        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {label}
      </Link>
    </Box>
  )
}

// Estado/transições extraídos como reducer puro (sem I/O, sem React) de propósito: o renderer
// interativo (act()/TestRenderer) trava o `node --test` deste projeto quando a árvore inclui
// react-router-dom (ver PostSupportersDialog.test.js) -- então a lógica de "carregar mais",
// erro e "tentar novamente" é testada aqui, como função pura.
export function initialSupportersDialogState() {
  return { supporters: [], nextCursor: null, loaded: false, loading: false, error: '' }
}

export function supportersDialogReducer(state, action) {
  switch (action.type) {
    case 'load_start':
      return { ...state, loading: true, error: '' }
    case 'load_success': {
      // Nunca repete alguém já listado (um apoio novo entre duas páginas deslocaria o cursor).
      const known = new Set(action.reset ? [] : state.supporters.map((item) => item.userId))
      const fresh = action.supporters.filter((item) => !known.has(item.userId))
      return {
        ...state,
        loading: false,
        loaded: true,
        supporters: action.reset ? fresh : [...state.supporters, ...fresh],
        nextCursor: action.nextCursor,
      }
    }
    case 'load_error':
      return { ...state, loading: false, error: action.message }
    default:
      return state
  }
}

// Conteúdo puro (sem <Dialog>/Portal do Primer) -- o Portal exige um document real, que este
// projeto não usa em teste; o <Dialog> abaixo é só um wrapper fino.
export function PostSupportersDialogBody({ statusId, supportCount }) {
  const [state, dispatch] = useReducer(
    supportersDialogReducer,
    undefined,
    initialSupportersDialogState
  )
  const { supporters, nextCursor, loaded, loading, error } = state

  async function loadPage({ reset = false } = {}) {
    dispatch({ type: 'load_start' })
    try {
      const result = await listPostSupporters(statusId, { cursor: reset ? null : nextCursor })
      dispatch({
        type: 'load_success',
        supporters: result.supporters,
        nextCursor: result.nextCursor,
        reset,
      })
    } catch (err) {
      console.error('[PostSupportersDialog] load:', err)
      dispatch({
        type: 'load_error',
        message: 'Não foi possível carregar a lista. Tente novamente.',
      })
    }
  }

  useEffect(() => {
    loadPage({ reset: true })
    // Só na abertura do modal (o componente é montado sob demanda) -- nunca no feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusId])

  return (
    <>
      <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mt: 0 }}>
        {supportCount} {supportCount === 1 ? 'curtida' : 'curtidas'}
      </Text>

      {error && (
        <Box role="alert" sx={{ color: 'danger.fg', fontSize: 1, mt: 2 }}>
          <Text as="p" sx={{ m: 0, mb: 2 }}>
            {error}
          </Text>
          <Button size="small" onClick={() => loadPage({ reset: !loaded })}>
            Tentar novamente
          </Button>
        </Box>
      )}

      <Box
        as="ul"
        sx={{ display: 'flex', flexDirection: 'column', listStyle: 'none', p: 0, m: 0, mt: 2 }}
      >
        {supporters.map((supporter) => (
          <li key={supporter.userId}>
            <SupporterRow supporter={supporter} />
          </li>
        ))}
      </Box>
      {!loading && loaded && supporters.length === 0 && !error && (
        <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Ninguém curtiu ainda.</Text>
      )}

      {loading && <Spinner aria-label="Carregando" sx={{ mt: 3 }} />}
      {nextCursor && !loading && !error && (
        <Button sx={{ mt: 3 }} block onClick={() => loadPage()}>
          Carregar mais
        </Button>
      )}
    </>
  )
}

export function PostSupportersDialog({ statusId, supportCount, onClose }) {
  return (
    <Dialog title="Quem curtiu" onClose={onClose} width="medium">
      <PostSupportersDialogBody statusId={statusId} supportCount={supportCount} />
    </Dialog>
  )
}

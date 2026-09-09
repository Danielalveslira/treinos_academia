import { Link as RouterLink } from 'react-router-dom'
import { Box, Heading, Text, Button, Spinner, Link } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PeopleIcon } from '@primer/octicons-react'
import { useCommunities } from '../hooks/useCommunities'
import { useToast } from '../hooks/useToast'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'

function CommunityAvatar({ community }) {
  return (
    <Box
      sx={{
        width: 40,
        height: 40,
        borderRadius: 2,
        bg: 'canvas.subtle',
        border: '1px solid',
        borderColor: 'border.default',
        flexShrink: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {community.imageUrl ? (
        <Box
          as="img"
          src={community.imageUrl}
          alt=""
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <PeopleIcon size={18} />
      )}
    </Box>
  )
}

function CommunityNameBlock({ community }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Text sx={{ fontWeight: 'bold', display: 'block' }}>{community.name}</Text>
      {community.description && (
        <Text
          sx={{
            fontSize: 0,
            color: 'fg.muted',
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {community.description}
        </Text>
      )}
    </Box>
  )
}

function CommunityRow({ community, action, linkTo }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        px: 3,
        py: 2,
        borderTop: '1px solid',
        borderColor: 'border.default',
        '&:first-of-type': { borderTop: 'none' },
      }}
    >
      {linkTo ? (
        <Link
          as={RouterLink}
          to={linkTo}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            flex: 1,
            minWidth: 0,
            color: 'fg.default',
          }}
        >
          <CommunityAvatar community={community} />
          <CommunityNameBlock community={community} />
        </Link>
      ) : (
        <>
          <CommunityAvatar community={community} />
          <CommunityNameBlock community={community} />
        </>
      )}
      {action}
    </Box>
  )
}

export default function Communities() {
  const { myCommunities, exploreCommunities, loading, error, refresh, join, leave } =
    useCommunities()
  const { toasts, showToast } = useToast()

  async function handleJoin(community) {
    try {
      await join(community.id)
      showToast(`Você entrou em ${community.name}.`)
    } catch (err) {
      console.error('[Communities] join:', err)
      showToast('Erro ao entrar na comunidade.', 'danger')
    }
  }

  async function handleLeave(community) {
    try {
      await leave(community.id)
      showToast(`Você saiu de ${community.name}.`)
    } catch (err) {
      console.error('[Communities] leave:', err)
      showToast('Erro ao sair da comunidade.', 'danger')
    }
  }

  return (
    <Box>
      <ToastFlash toasts={toasts} />
      <Heading as="h1" sx={{ fontSize: 3, mb: 3 }}>
        Comunidades
      </Heading>

      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && (
        <>
          <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
            Minhas comunidades
          </Heading>
          {myCommunities.length === 0 ? (
            <Text sx={{ color: 'fg.muted', fontSize: 1, display: 'block', mb: 4 }}>
              Você ainda não entrou em nenhuma comunidade.
            </Text>
          ) : (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'border.default',
                borderRadius: 2,
                overflow: 'hidden',
                mb: 4,
              }}
            >
              {myCommunities.map((community) => (
                <CommunityRow
                  key={community.id}
                  community={community}
                  linkTo={`/comunidades/${community.id}`}
                  action={
                    <Button size="small" onClick={() => handleLeave(community)}>
                      Sair
                    </Button>
                  }
                />
              ))}
            </Box>
          )}

          <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
            Explorar
          </Heading>
          {exploreCommunities.length === 0 ? (
            <Blankslate>
              <Blankslate.Visual>
                <PeopleIcon size={24} />
              </Blankslate.Visual>
              <Blankslate.Heading>Nenhuma comunidade nova</Blankslate.Heading>
              <Blankslate.Description>
                Você já está em todas as comunidades disponíveis.
              </Blankslate.Description>
            </Blankslate>
          ) : (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'border.default',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              {exploreCommunities.map((community) => (
                <CommunityRow
                  key={community.id}
                  community={community}
                  action={
                    <Button size="small" variant="primary" onClick={() => handleJoin(community)}>
                      Entrar
                    </Button>
                  }
                />
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

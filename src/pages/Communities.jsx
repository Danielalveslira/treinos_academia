import { Link as RouterLink } from 'react-router-dom'
import { Box, Heading, Text, Button, Spinner, Link } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { ChevronRightIcon, PeopleIcon } from '@primer/octicons-react'
import { useCommunities } from '../hooks/useCommunities'
import { useToast } from '../hooks/useToast'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'

function CommunityAvatar({ community }) {
  return (
    <Box
      sx={{
        width: 32,
        height: 32,
        borderRadius: 2,
        bg: 'canvas.subtle',
        color: 'fg.muted',
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
      <Text className="community-row-name">{community.name}</Text>
      {community.description && (
        <Text className="community-row-description">{community.description}</Text>
      )}
    </Box>
  )
}

// Uma linha inteira precisa deixar claro, de cara, se ela é "toque para abrir" ou só
// uma linha informativa com um botão — antes disso dependia inteiramente do link do
// nome ter (ou não) a cor/sublinhado padrão do Primer, algo sutil demais para
// diferenciar duas comunidades na mesma lista (o motivo do usuário relatar confusão).
// Agora todo item com linkTo ganha o mesmo tratamento visível (fundo ao passar o mouse/
// focar, seta no fim) e o botão de ação fica visualmente separado por um divisor, nunca
// dentro da área clicável de navegação.
function CommunityRow({ community, action, linkTo }) {
  const content = (
    <>
      <CommunityAvatar community={community} />
      <CommunityNameBlock community={community} />
    </>
  )
  return (
    <Box className="community-row">
      {linkTo ? (
        <Link as={RouterLink} to={linkTo} className="community-row-link">
          {content}
          <ChevronRightIcon size={16} className="community-row-chevron" />
        </Link>
      ) : (
        <Box className="community-row-static">{content}</Box>
      )}
      {action && <Box className="community-row-action">{action}</Box>}
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
    <Box className="community-page">
      <ToastFlash toasts={toasts} />
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 2,
          mb: 3,
        }}
      >
        <Heading as="h1" sx={{ m: 0 }}>
          Comunidades
        </Heading>
        <Button onClick={refresh} loading={loading} disabled={loading}>
          Atualizar
        </Button>
      </Box>

      {loading && myCommunities.length === 0 && exploreCommunities.length === 0 && (
        <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />
      )}
      <ErrorState error={error} onRetry={refresh} />

      {!error && (myCommunities.length > 0 || exploreCommunities.length > 0 || !loading) && (
        <>
          <Heading as="h2" sx={{ fontSize: 1, mb: 2 }}>
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

          <Heading as="h2" sx={{ fontSize: 1, mb: 2 }}>
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

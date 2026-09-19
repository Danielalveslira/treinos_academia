import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Heading,
  Text,
  Button,
  Spinner,
  Link,
  ActionMenu,
  ActionList,
  IconButton,
} from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  ChevronRightIcon,
  KebabHorizontalIcon,
  PeopleIcon,
  SignOutIcon,
} from '@primer/octicons-react'
import { useCommunities } from '../hooks/useCommunities'
import { useToast } from '../hooks/useToast'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { CommunityIcon } from '../components/CommunityIcon'
import { listFeaturedCommunities, recordPromotionClick } from '../services/promotionsService'

function CommunityNameBlock({ community }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Text className="community-row-name">{community.name}</Text>
      <Text className="community-row-description">
        {community.memberCount ?? 0} {community.memberCount === 1 ? 'membro' : 'membros'}
      </Text>
    </Box>
  )
}

// "Sair" fica atrás do ⋯ (em vez de um botão sempre visível ao lado de cada linha) —
// mesmo padrão de RowActionsMenu (Exercícios/Histórico): um único gatilho visível,
// funciona igual em toque ou clique, sem precisar de gesto novo (toque longo/botão
// direito) que não existe em nenhum outro lugar do app.
function LeaveCommunityMenu({ onLeave, disabled }) {
  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButton
          disabled={disabled}
          icon={KebabHorizontalIcon}
          variant="invisible"
          aria-label="Mais ações"
          sx={{ color: 'fg.muted' }}
        />
      </ActionMenu.Anchor>
      <ActionMenu.Overlay align="end">
        <ActionList>
          <ActionList.Item variant="danger" disabled={disabled} onSelect={onLeave}>
            <ActionList.LeadingVisual>
              <SignOutIcon />
            </ActionList.LeadingVisual>
            Sair da comunidade
          </ActionList.Item>
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

// Uma linha inteira precisa deixar claro, de cara, se ela é "toque para abrir" ou só
// uma linha informativa com um botão — antes disso dependia inteiramente do link do
// nome ter (ou não) a cor/sublinhado padrão do Primer, algo sutil demais para
// diferenciar duas comunidades na mesma lista (o motivo do usuário relatar confusão).
// Agora todo item com linkTo ganha o mesmo tratamento visível (fundo ao passar o mouse/
// focar, seta no fim) e o botão/menu de ação fica visualmente separado por um divisor,
// nunca dentro da área clicável de navegação.
function CommunityRow({ community, action, linkTo, onNavigate }) {
  const content = (
    <>
      <CommunityIcon community={community} />
      <CommunityNameBlock community={community} />
    </>
  )
  return (
    <Box className="community-row">
      {linkTo ? (
        <Link as={RouterLink} to={linkTo} className="community-row-link" onClick={onNavigate}>
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

// Métrica informativa (App Check ainda adiado, nunca base de cobrança/ranking) --
// "fogo e esquece": clicar precisa navegar mesmo se o registro falhar, então a falha só
// vai pro console, nunca bloqueia/atrasa a navegação nem mostra um toast de erro.
function recordFeaturedCommunityClick(community) {
  if (!community.activePromotionId) return
  recordPromotionClick({
    targetType: 'community',
    targetId: community.id,
    promotionId: community.activePromotionId,
  }).catch((err) => console.error('[Communities] recordPromotionClick:', err))
}

export default function Communities() {
  const { myCommunities, exploreCommunities, loading, error, refresh, join, leave } =
    useCommunities()
  const { toasts, showToast } = useToast()
  const membershipLock = useRef(false)
  const [pendingCommunityId, setPendingCommunityId] = useState(null)

  // Fase 6 -- "comunidades em destaque" (promovidas com EvoCash pelo próprio dono).
  // communities/{id} não é restrita por membership na leitura (ver firestore.rules),
  // então não precisa de nenhum gate de "só depois de confirmar participação" aqui.
  const [featuredCommunities, setFeaturedCommunities] = useState([])
  useEffect(() => {
    let active = true
    listFeaturedCommunities()
      .then((items) => {
        if (active) setFeaturedCommunities(items)
      })
      .catch((err) => console.error('[Communities] listFeaturedCommunities:', err))
    return () => {
      active = false
    }
  }, [])

  function beginMembershipChange(communityId) {
    if (membershipLock.current) return false
    membershipLock.current = true
    setPendingCommunityId(communityId)
    return true
  }

  function endMembershipChange() {
    membershipLock.current = false
    setPendingCommunityId(null)
  }

  async function handleJoin(community) {
    if (!beginMembershipChange(community.id)) return
    try {
      await join(community.id)
      showToast(`Você entrou em ${community.name}.`)
    } catch (err) {
      console.error('[Communities] join:', err)
      showToast('Erro ao entrar na comunidade.', 'danger')
    } finally {
      endMembershipChange()
    }
  }

  async function handleLeave(community) {
    if (!beginMembershipChange(community.id)) return
    try {
      await leave(community.id)
      showToast(`Você saiu de ${community.name}.`)
    } catch (err) {
      console.error('[Communities] leave:', err)
      showToast('Erro ao sair da comunidade.', 'danger')
    } finally {
      endMembershipChange()
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
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button as={RouterLink} to="/comunidades/criar">
            Criar comunidade
          </Button>
          <Button onClick={refresh} loading={loading} disabled={loading}>
            Atualizar
          </Button>
        </Box>
      </Box>

      {loading && myCommunities.length === 0 && exploreCommunities.length === 0 && (
        <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />
      )}
      <ErrorState error={error} onRetry={refresh} />

      {featuredCommunities.length > 0 && (
        <>
          <Heading as="h2" sx={{ fontSize: 1, mb: 2 }}>
            Comunidades em destaque
          </Heading>
          <Box
            sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, overflow: 'hidden', mb: 4 }}
          >
            {featuredCommunities.map((community) => (
              <CommunityRow
                key={community.id}
                community={community}
                linkTo={`/comunidades/${community.id}`}
                onNavigate={() => recordFeaturedCommunityClick(community)}
              />
            ))}
          </Box>
        </>
      )}

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
                    <LeaveCommunityMenu
                      onLeave={() => handleLeave(community)}
                      disabled={pendingCommunityId !== null}
                    />
                  }
                />
              ))}
            </Box>
          )}

          <Heading as="h2" sx={{ fontSize: 1, mb: 2 }}>
            Explorar
          </Heading>
          {exploreCommunities.length === 0 ? (
            <Box
              sx={{
                border: '1px dashed',
                borderColor: 'border.muted',
                borderRadius: 2,
              }}
            >
              <Blankslate>
                <Blankslate.Visual>
                  <PeopleIcon size={24} />
                </Blankslate.Visual>
                <Blankslate.Heading>Você já está em todas</Blankslate.Heading>
                <Blankslate.Description>
                  Não há novas comunidades no momento.
                </Blankslate.Description>
              </Blankslate>
            </Box>
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
                    <Button
                      size="small"
                      variant="primary"
                      loading={pendingCommunityId === community.id}
                      disabled={pendingCommunityId !== null}
                      onClick={() => handleJoin(community)}
                    >
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

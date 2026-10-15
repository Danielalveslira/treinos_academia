import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Spinner, Button, ActionMenu, ActionList, IconButton } from '@primer/react'
import {
  AlertIcon,
  ChevronRightIcon,
  KebabHorizontalIcon,
  PeopleIcon,
  PlusIcon,
  SignOutIcon,
  StarFillIcon,
  SyncIcon,
} from '@primer/octicons-react'
import { Compass } from 'lucide-react'
import { useCommunities } from '../hooks/useCommunities'
import { useCommunityActivity } from '../hooks/useCommunityActivity'
import { ErrorState } from '../components/ErrorState'
import { CommunityIcon } from '../components/CommunityIcon'
import { CommunityCoverImage } from '../components/CommunityCoverImage'
import { CommunityExploreCard } from '../components/CommunityExploreCard'
import { CommunityBlockedNotice } from '../components/CommunityBlockedNotice'
import { ResponsivePicture } from '../components/ResponsivePicture'
import { ProfileAvatar } from '../components/ProfileAvatar'
import { listFeaturedCommunities, recordPromotionClick } from '../services/promotionsService'
import { formatMemberCount, formatRelativeTime } from '../utils/communityActivity'
import { classifyReadError } from '../services/offline/readError'
import { COMMUNITY_MESSAGES, describeJoinFailure } from '../utils/communityAccess'

// "Sair" fica atrás do ⋯ (em vez de um botão sempre visível em cada cartão) — mesmo padrão
// de RowActionsMenu (Exercícios/Histórico): um único gatilho visível, funciona igual em
// toque ou clique, sem gesto novo (toque longo/botão direito) que não existe em nenhum
// outro lugar do app.
function LeaveCommunityMenu({ onLeave, disabled }) {
  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButton
          disabled={disabled}
          icon={KebabHorizontalIcon}
          variant="invisible"
          aria-label="Mais ações"
          className="community-card-menu-button"
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

// Status curto da comunidade: avatar do autor + "Última atividade: @fulano há 6d" numa
// badge sutil -- sem o trecho da publicação (removido para reduzir carga visual do
// cartão). Enquanto o status ainda carrega não mostra nada (sem "pulo" de layout).
function CommunityActivityStatus({ activity, ready }) {
  if (activity) {
    const author = typeof activity.authorUsername === 'string' ? activity.authorUsername : null
    const time = formatRelativeTime(activity.createdAt)
    const label = author
      ? `Última atividade: @${author}${time ? ` ${time}` : ''}`
      : 'Atividade recente'
    return (
      <div className="community-card-status">
        <ProfileAvatar
          path={activity.authorAvatarPath}
          name={author || 'M'}
          className="community-card-avatar"
        />
        <span className="community-card-status-badge">{label}</span>
      </div>
    )
  }
  if (!ready) return null
  return (
    <div className="community-card-status community-card-status--empty">
      <span className="community-card-status-text">Comece a conversa!</span>
    </div>
  )
}

// O cartão inteiro é a área de toque (o link do nome estica por ::after sobre o cartão) e o
// menu ⋯ fica acima dessa camada — assim não há botão aninhado em link e o alvo de toque
// é o maior possível sem nenhum gesto novo. A seta no canto inferior direito é só um
// reforço visual de "entrar" (decorativa, aria-hidden) -- o alvo de toque continua sendo
// o cartão inteiro, não só ela.
function CommunityCard({ community, linkTo, onNavigate, menu, badge, error, children }) {
  const hasCover = Boolean(community.coverPath)
  return (
    <article className="community-card">
      {hasCover && (
        <>
          <div className="community-cover">
            <CommunityCoverImage path={community.coverPath} className="community-cover-image" />
          </div>
          {/* O ícone escolhido na criação continua aparecendo mesmo com capa -- só sai da
              linha do título e passa a sobrepor a borda da capa, menor (mesma classe
              compartilhada com o cartão de Explorar, ver CommunityExploreCard.jsx). */}
          <span className="community-cover-icon">
            <CommunityIcon community={community} size={40} />
          </span>
        </>
      )}
      <div className={`community-card-top${hasCover ? ' community-card-top--with-cover' : ''}`}>
        {!hasCover && <CommunityIcon community={community} size={48} />}
        <div className="community-card-info">
          <RouterLink to={linkTo} className="community-card-link" onClick={onNavigate}>
            {community.name}
          </RouterLink>
          <p className="community-card-meta">
            {badge}
            <span>{formatMemberCount(community.memberCount)}</span>
          </p>
        </div>
        {menu && <div className="community-card-menu">{menu}</div>}
      </div>
      {children}
      {error && (
        <CommunityBlockedNotice
          className="community-blocked-notice--in-card"
          icon={AlertIcon}
          title={error}
        />
      )}
      <span className="community-card-chevron" aria-hidden="true">
        <ChevronRightIcon size={16} />
      </span>
    </article>
  )
}

// Imagem decorativa do topo (public/img/comunidades-hero-<largura>.*; original em
// imports/images-source/). 1600w só serve telas largas/retina.
const HERO_WIDTHS = [480, 800, 1024, 1600]

function SectionHeading({ icon, title, subtitle, id }) {
  return (
    <header className="communities-section-heading">
      <span className="communities-section-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h2 id={id}>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </header>
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
  const { activity, isActivityChecked, reloadActivity } = useCommunityActivity(
    myCommunities.map((community) => community.id)
  )
  const membershipLock = useRef(false)
  const [pendingCommunityId, setPendingCommunityId] = useState(null)
  // Erro da última entrada/saída, só no cartão que disparou a ação -- nunca um toast
  // flutuando no topo da página (ficava atrás da imagem da capa do hero). Sucesso não
  // mostra nenhum aviso: o cartão já muda de lista/seção sozinho, o que já é a
  // confirmação visual. { communityId, kind: 'banned' | 'error', title?, text? } | null
  const [actionError, setActionError] = useState(null)

  // Fase 6 -- "comunidades em destaque" (promovidas com EvoCash pelo próprio dono).
  // communities não é restrita por membership na leitura (ver policy communities_select),
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

  function clearActionError(communityId) {
    setActionError((current) => (current?.communityId === communityId ? null : current))
  }

  // O servidor devolve um ESTADO ('joined' | 'already_member' | 'banned' | 'unavailable'). Banimento é
  // autorização, não erro: o cartão passa a "Acesso bloqueado" com um aviso contextual nele mesmo. Só
  // falhas reais (rede, inesperado) e indisponibilidade também viram aviso contextual, nunca um toast.
  async function handleJoin(community) {
    if (!beginMembershipChange(community.id)) return
    clearActionError(community.id)
    try {
      const result = await join(community.id)
      if (result === 'banned') {
        setActionError({ communityId: community.id, kind: 'banned' })
      } else if (result === 'unavailable') {
        setActionError({ communityId: community.id, kind: 'error', title: COMMUNITY_MESSAGES.unavailable })
      }
    } catch (err) {
      console.error('[Communities] join:', err)
      setActionError({
        communityId: community.id,
        kind: 'error',
        title: describeJoinFailure(classifyReadError(err)),
      })
    } finally {
      endMembershipChange()
    }
  }

  async function handleLeave(community) {
    if (!beginMembershipChange(community.id)) return
    clearActionError(community.id)
    try {
      await leave(community.id)
    } catch (err) {
      console.error('[Communities] leave:', err)
      setActionError({ communityId: community.id, kind: 'error', title: 'Erro ao sair da comunidade.' })
    } finally {
      endMembershipChange()
    }
  }

  function handleRefresh() {
    refresh()
    reloadActivity()
  }

  const showLists =
    !error && (myCommunities.length > 0 || exploreCommunities.length > 0 || !loading)

  return (
    <div className="community-page community-page--hub">
      <header className="communities-hero">
        <div className="communities-hero-media" aria-hidden="true">
          <ResponsivePicture
            name="comunidades-hero"
            alt=""
            width={1600}
            height={900}
            widths={HERO_WIDTHS}
            sizes="(min-width: 1184px) 1184px, 100vw"
            priority
          />
        </div>
        <div className="communities-hero-text">
          <h1>Comunidades</h1>
          <p>Treine, compartilhe e evolua junto.</p>
        </div>
        <div className="communities-hero-actions">
          <Button
            as={RouterLink}
            to="/comunidades/criar"
            variant="primary"
            leadingVisual={PlusIcon}
            className="communities-create-button"
          >
            Criar comunidade
          </Button>
          <IconButton
            onClick={handleRefresh}
            loading={loading}
            disabled={loading}
            variant="invisible"
            icon={SyncIcon}
            aria-label="Atualizar"
            className="communities-refresh-button"
          />
        </div>
      </header>

      {loading && myCommunities.length === 0 && exploreCommunities.length === 0 && (
        <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />
      )}
      <ErrorState error={error} onRetry={refresh} />

      {featuredCommunities.length > 0 && (
        <section className="communities-section" aria-labelledby="communities-featured">
          <SectionHeading
            icon={<StarFillIcon size={18} />}
            title="Em destaque"
            id="communities-featured"
          />
          <div className="communities-grid">
            {featuredCommunities.map((community) => (
              <CommunityCard
                key={community.id}
                community={community}
                linkTo={`/comunidades/${community.id}`}
                onNavigate={() => recordFeaturedCommunityClick(community)}
                badge={<span className="community-card-pill">Destaque</span>}
              />
            ))}
          </div>
        </section>
      )}

      {showLists && (
        <>
          <section className="communities-section" aria-labelledby="communities-mine">
            <SectionHeading
              icon={<PeopleIcon size={18} />}
              title="Minhas comunidades"
              id="communities-mine"
            />
            {myCommunities.length === 0 ? (
              <div className="communities-empty">
                <span className="communities-empty-icon" aria-hidden="true">
                  <PeopleIcon size={18} />
                </span>
                <div>
                  <p className="communities-empty-title">
                    Você ainda não entrou em nenhuma comunidade
                  </p>
                  <p className="communities-empty-text">Entre em uma abaixo ou crie a sua.</p>
                </div>
              </div>
            ) : (
              <div className="communities-grid">
                {myCommunities.map((community) => (
                  <CommunityCard
                    key={community.id}
                    community={community}
                    linkTo={`/comunidades/${community.id}`}
                    menu={
                      <LeaveCommunityMenu
                        onLeave={() => handleLeave(community)}
                        disabled={pendingCommunityId !== null}
                      />
                    }
                    error={
                      actionError?.communityId === community.id ? actionError.title : null
                    }
                  >
                    <CommunityActivityStatus
                      activity={activity[community.id]}
                      ready={isActivityChecked(community.id)}
                    />
                  </CommunityCard>
                ))}
              </div>
            )}
          </section>

          <section className="communities-section" aria-labelledby="communities-explore">
            <SectionHeading
              icon={<Compass size={18} />}
              title="Explorar comunidades"
              id="communities-explore"
            />
            {exploreCommunities.length === 0 ? (
              <p className="communities-explore-empty">
                Você já participa de todas as comunidades disponíveis no momento.
              </p>
            ) : (
              <div className="communities-grid communities-grid--explore">
                {exploreCommunities.map((community) => (
                  <CommunityExploreCard
                    key={community.id}
                    community={community}
                    joining={pendingCommunityId === community.id}
                    disabled={pendingCommunityId !== null}
                    onJoin={handleJoin}
                    error={actionError?.communityId === community.id ? actionError : null}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

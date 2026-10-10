import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Spinner, Button, ActionMenu, ActionList, IconButton } from '@primer/react'
import {
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
import { useToast } from '../hooks/useToast'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { CommunityIcon } from '../components/CommunityIcon'
import { CommunityExploreCard } from '../components/CommunityExploreCard'
import { ResponsivePicture } from '../components/ResponsivePicture'
import { ProfileAvatar } from '../components/ProfileAvatar'
import { listFeaturedCommunities, recordPromotionClick } from '../services/promotionsService'
import {
  describeActivityPreview,
  formatMemberCount,
  formatRelativeTime,
} from '../utils/communityActivity'
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

// Prévia discreta da última publicação: autor, tempo relativo e um trecho curto. Enquanto a
// prévia ainda carrega não mostra nada (sem "pulo" de layout para o estado vazio).
function CommunityActivityPreview({ activity, ready }) {
  if (activity) {
    const author = typeof activity.authorUsername === 'string' ? activity.authorUsername : null
    const time = formatRelativeTime(activity.createdAt)
    const text = describeActivityPreview(activity)
    return (
      <div className="community-card-preview">
        <ProfileAvatar
          path={activity.authorAvatarPath}
          name={author || 'M'}
          className="community-card-avatar"
        />
        <div className="community-card-preview-body">
          <p className="community-card-preview-meta">
            <strong>{author ? `@${author}` : 'Membro'}</strong>
            {time && <span> · {time}</span>}
          </p>
          {text && <p className="community-card-preview-text">{text}</p>}
        </div>
      </div>
    )
  }
  if (!ready) return null
  return (
    <div className="community-card-preview community-card-preview--empty">
      <p className="community-card-preview-text">Ainda sem publicações. Comece a conversa!</p>
    </div>
  )
}

// O cartão inteiro é a área de toque (o link do nome estica por ::after sobre o cartão) e o
// menu ⋯ fica acima dessa camada — assim não há botão aninhado em link e o alvo de toque
// é o maior possível sem nenhum gesto novo.
function CommunityCard({ community, linkTo, onNavigate, menu, badge, children }) {
  return (
    <article className="community-card">
      <div className="community-card-top">
        <CommunityIcon community={community} size={48} />
        <div className="community-card-info">
          <RouterLink to={linkTo} className="community-card-link" onClick={onNavigate}>
            {community.name}
          </RouterLink>
          <p className="community-card-meta">
            {badge}
            <span>{formatMemberCount(community.memberCount)}</span>
          </p>
        </div>
        <ChevronRightIcon size={16} className="community-card-chevron" />
        {menu && <div className="community-card-menu">{menu}</div>}
      </div>
      {children}
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
  const { toasts, showToast } = useToast()
  const membershipLock = useRef(false)
  const [pendingCommunityId, setPendingCommunityId] = useState(null)
  // Cartão cuja tentativa de entrada acabou de ser recusada por banimento (mostra o aviso compacto nele).
  const [blockedNoticeId, setBlockedNoticeId] = useState(null)

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

  // O servidor devolve um ESTADO ('joined' | 'already_member' | 'banned' | 'unavailable'). Banimento é
  // autorização, não erro: o cartão passa a "Acesso bloqueado" com um aviso contextual, sem alerta vermelho no
  // topo. Só falhas reais (rede, inesperado) viram toast de erro, com mensagem própria e sem texto técnico.
  async function handleJoin(community) {
    if (!beginMembershipChange(community.id)) return
    try {
      const result = await join(community.id)
      if (result === 'banned') {
        setBlockedNoticeId(community.id)
      } else if (result === 'unavailable') {
        showToast(COMMUNITY_MESSAGES.unavailable, 'danger')
      } else {
        showToast(`Você entrou em ${community.name}.`)
      }
    } catch (err) {
      console.error('[Communities] join:', err)
      showToast(describeJoinFailure(classifyReadError(err)), 'danger')
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

  function handleRefresh() {
    refresh()
    reloadActivity()
  }

  const showLists =
    !error && (myCommunities.length > 0 || exploreCommunities.length > 0 || !loading)

  return (
    <div className="community-page community-page--hub">
      <ToastFlash toasts={toasts} />

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
          <Button
            onClick={handleRefresh}
            loading={loading}
            disabled={loading}
            variant="invisible"
            leadingVisual={SyncIcon}
            className="communities-refresh-button"
          >
            Atualizar
          </Button>
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
                  >
                    <CommunityActivityPreview
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
              subtitle="Descubra grupos com os mesmos objetivos que você."
              id="communities-explore"
            />
            {exploreCommunities.length === 0 ? (
              <div className="communities-empty">
                <span className="communities-empty-icon" aria-hidden="true">
                  <Compass size={18} />
                </span>
                <div>
                  <p className="communities-empty-title">Você já está em todas</p>
                  <p className="communities-empty-text">
                    Quando surgirem novas comunidades, elas aparecem aqui.
                  </p>
                </div>
              </div>
            ) : (
              <div className="communities-grid communities-grid--explore">
                {exploreCommunities.map((community) => (
                  <CommunityExploreCard
                    key={community.id}
                    community={community}
                    joining={pendingCommunityId === community.id}
                    disabled={pendingCommunityId !== null}
                    onJoin={handleJoin}
                    showBlockedNotice={blockedNoticeId === community.id}
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

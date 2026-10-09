import { lazy, useEffect, useRef, useState } from 'react'
import { Button, Spinner } from '@primer/react'
import {
  ChevronRightIcon,
  GraphIcon,
  MegaphoneIcon,
  PlusIcon,
  StarIcon,
} from '@primer/octicons-react'
import { StatusCard } from './StatusCard'
import { SponsoredAdBanner } from './SponsoredAdBanner'
import { FeaturedSpotlight } from './FeaturedSpotlight'
import { SponsoredAdCard } from './SponsoredAdCard'
import { LazyDialogBoundary } from './LazyDialogBoundary'
import { ErrorState } from './ErrorState'
import { useNowSelector } from '../utils/clock'
import { toMillis } from '../utils/expiry.js'
import { isStatusLoaded } from '../utils/sharedStatus'
import { interleaveAds } from '../utils/sponsoredAds'

// Formulários que só abrem quando o usuário toca em "Publicar"/"Compartilhar progresso": ficam fora do
// carregamento inicial da comunidade (e são aquecidos em ociosidade, abaixo, para o toque ser imediato).
const loadStatusForm = () =>
  import('./StatusForm').then((module) => ({ default: module.StatusForm }))
const loadProgressShare = () =>
  import('./CommunityProgressShare').then((module) => ({ default: module.CommunityProgressShare }))
const StatusForm = lazy(loadStatusForm)
const CommunityProgressShare = lazy(loadProgressShare)

function warmForms() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  loadStatusForm().catch(() => {})
  loadProgressShare().catch(() => {})
}

// Só aquece em ociosidade com sinal POSITIVO de conexão boa (a API só existe em navegadores Chromium; sem
// ela, só a intenção do usuário dispara o download).
function canWarmFormsOnIdle() {
  const connection = typeof navigator !== 'undefined' ? navigator.connection : null
  return Boolean(connection) && connection.saveData !== true && connection.effectiveType === '4g'
}

function prefersSavingData() {
  return typeof navigator !== 'undefined' && navigator.connection?.saveData === true
}

const FEED_TABS = [
  { id: 'recent', label: 'Recentes' },
  { id: 'featured', label: 'Destaques' },
]

// Abas Recentes/Destaques (padrão ARIA tabs: setas movem a seleção, só a aba ativa entra na ordem de Tab).
function FeedTabs({ value, onChange, featuredCount, featuredMounted }) {
  function handleKeyDown(event) {
    const index = FEED_TABS.findIndex((tab) => tab.id === value)
    const next =
      event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : null
    if (next === null) return
    event.preventDefault()
    const tab = FEED_TABS[(next + FEED_TABS.length) % FEED_TABS.length]
    onChange(tab.id)
    document.getElementById(`cd-tab-${tab.id}`)?.focus()
  }
  return (
    <div className="cd-tabs" role="tablist" aria-label="Publicações" onKeyDown={handleKeyDown}>
      {FEED_TABS.map((tab) => (
        <button
          key={tab.id}
          id={`cd-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          aria-controls={
            tab.id === 'featured' && !featuredMounted ? undefined : `cd-feed-panel-${tab.id}`
          }
          tabIndex={value === tab.id ? 0 : -1}
          className="cd-tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.id === 'featured' && <StarIcon size={14} />}
          {tab.label}
          {tab.id === 'featured' && featuredCount > 0 && (
            <span className="cd-tab-count">{featuredCount}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// Rodapé de paginação: um sentinela perto do fim dispara a próxima página sozinho (a não ser que o
// aparelho esteja no modo de economia de dados) e o botão cobre quem prefere controlar, quem usa
// teclado e quem está sem IntersectionObserver. Falha mostra o erro com "Tentar novamente".
// O observador é RECRIADO a cada página que chega (count): se o sentinela ainda estiver perto da tela,
// a nova observação já avisa e busca a seguinte, até a tela encher; senão espera o usuário rolar.
function FeedPager({ hasMore, loadingMore, moreError, onLoadMore, count }) {
  const sentinelRef = useRef(null)
  const auto = hasMore && !loadingMore && !moreError && !prefersSavingData()
  useEffect(() => {
    const element = sentinelRef.current
    if (!auto || !element || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
      },
      { rootMargin: '700px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [auto, count, onLoadMore])

  if (!hasMore && !moreError) {
    return count > 0 ? <p className="cd-feed-end">Você viu tudo por aqui.</p> : null
  }
  return (
    <div className="cd-pager" ref={sentinelRef}>
      {moreError ? (
        <ErrorState error={moreError} onRetry={onLoadMore} />
      ) : (
        <Button onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'Carregando…' : 'Carregar mais publicações'}
        </Button>
      )}
    </div>
  )
}

// View pura (sem hooks de dados) separada do wrapper que busca os dados de verdade (CommunityDetail) --
// mesmo padrão de WalletHeaderBadgesView/PromoteDialogBody: testável só com props.
// Ordem preservada: criação de conteúdo + publicidade vêm antes do conteúdo; treinos marcados e a
// publicação de um link ficam no topo de "Recentes" (ação real antes de conteúdo corrido); "Destaques"
// (posts PROMOVIDOS, pagos) agora é uma aba própria e nunca se mistura com os critérios de "Próximos
// treinos" (que é por DATA do evento). Quem abre um link de publicação cai em "Recentes", onde o alvo
// é resolvido por ID mesmo fora das páginas já carregadas.
// Referência estável para listas de anúncios vazias (evita refazer efeitos/memos a cada render).
const NO_ADS = []

export function CommunityFeedSection({
  communityId,
  communityName,
  currentUserId,
  author,
  canModerate,
  canPost,
  bannerAds,
  reserveBannerSlot = false,
  reserveFeedTopPx = 0,
  onTopAdsHeight,
  feedAds,
  inlineFeedAds = [],
  inlineFirstAfter,
  upcomingWorkouts = [],
  sharedStatus = null,
  loadingUpcomingWorkouts = false,
  upcomingWorkoutsError = null,
  featuredStatuses,
  statuses,
  authorAvatars = {},
  loadingFeed,
  feedError,
  hasMore = false,
  loadingMore = false,
  moreError = null,
  loadMore = () => {},
  formOpen,
  setFormOpen,
  refreshFeed,
  now,
  showToast,
  votesByStatusId,
  onEconomyVoted,
  onDeleteStatus,
  onCreateStatus,
  onPromoted,
  onCommentCountChange,
  refreshEpoch = 0,
  initialTab = 'recent',
}) {
  const [tab, setTab] = useState(initialTab)
  const topAdsRef = useRef(null)
  // Altura do bloco de cards do topo, medida uma vez quando a lista de anúncios muda (alimenta a dica de espaço).
  useEffect(() => {
    onTopAdsHeight?.(feedAds.length > 0 ? (topAdsRef.current?.offsetHeight ?? 0) : 0)
  }, [feedAds, onTopAdsHeight])
  // "Recentes" fica sempre montado (só escondido ao trocar de aba): voltar a ele é instantâneo e não perde a
  // posição nem as páginas já carregadas. "Destaques" só é montado na primeira vez que alguém o abre.
  const [featuredMounted, setFeaturedMounted] = useState(initialTab === 'featured')
  function changeTab(next) {
    if (next === 'featured') setFeaturedMounted(true)
    setTab(next)
  }
  // Abrir um destaque do card: vai para a aba Destaques e rola até a publicação (âncora "destaque-<id>").
  const scrollTargetRef = useRef(null)
  function openFeatured(status) {
    scrollTargetRef.current = `destaque-${status.id}`
    changeTab('featured')
  }
  useEffect(() => {
    if (tab !== 'featured' || !scrollTargetRef.current || typeof document === 'undefined')
      return undefined
    const targetId = scrollTargetRef.current
    scrollTargetRef.current = null
    const raf = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0))
    const caf = globalThis.cancelAnimationFrame || clearTimeout
    const frame = raf(() => document.getElementById(targetId)?.scrollIntoView?.({ block: 'start' }))
    return () => caf(frame)
  }, [tab])
  // Relógio compartilhado por minuto: "próximos treinos" some quando o treino passa, sem tick por card.
  const currentTime = useNowSelector(
    now,
    (n) => Math.floor(n / 60000) * 60000,
    (value) => toMillis(value) || Date.now()
  )

  // O formulário de publicar arrasta ~260 kB (editor com prévia de markdown). Não vale baixar isso a cada
  // abertura para quem só vai ler: aquece por INTENÇÃO (toque/foco/mouse num dos botões) e, em ociosidade,
  // só se o feed já apareceu e a conexão for 4G sem economia de dados. Sem isso, o chunk vem ao tocar e o
  // formulário mostra um indicador de carregamento.
  useEffect(() => {
    if (!canPost || loadingFeed || !canWarmFormsOnIdle()) return undefined
    const idle = globalThis.requestIdleCallback || ((callback) => setTimeout(callback, 2000))
    const cancel = globalThis.cancelIdleCallback || clearTimeout
    const handle = idle(warmForms, { timeout: 6000 })
    return () => cancel(handle)
  }, [canPost, loadingFeed])

  // Publicação alvo de um link (resolvida por ID quando fora das páginas carregadas): um treino futuro
  // entra em "Próximos treinos"; qualquer outra (ou treino já passado) ganha bloco próprio.
  const workoutCandidates =
    sharedStatus?.type === 'workout' ? [sharedStatus, ...upcomingWorkouts] : upcomingWorkouts
  const visibleUpcomingWorkouts = workoutCandidates.filter(
    (status, index, items) =>
      toMillis(status.workout?.date) > currentTime &&
      items.findIndex((candidate) => candidate.id === status.id) === index
  )
  const upcomingWorkoutIds = new Set(visibleUpcomingWorkouts.map((status) => status.id))
  // Destaque é promoção PAGA e com prazo: a lista vem filtrada pelo servidor só no instante da leitura e fica em
  // cache; aqui a validade é conferida de novo com o relógio, para uma promoção encerrada deixar a aba, o contador
  // e o resumo do topo no máximo ~1 minuto depois do fim (e nunca por causa da cache).
  const visibleFeaturedStatuses = featuredStatuses.filter(
    (status) =>
      !upcomingWorkoutIds.has(status.id) &&
      status.promoted === true &&
      toMillis(status.promotedUntil) > currentTime
  )
  const visibleStatuses = statuses.filter((status) => !upcomingWorkoutIds.has(status.id))
  // "Recentes" é onde o link cai: um post que só existe em Destaques ainda precisa do bloco do link.
  const linkedStatus =
    sharedStatus && !isStatusLoaded(sharedStatus.id, visibleUpcomingWorkouts, visibleStatuses)
      ? sharedStatus
      : null

  const cardProps = {
    currentUserId,
    canModerate,
    onDelete: onDeleteStatus,
    communityName,
    showToast,
    onEconomyVoted,
    onPromoted,
    onCommentCountChange,
    refreshEpoch,
    now,
  }
  const renderCard = (status, keyPrefix = '', anchorPrefix = '') => (
    <StatusCard
      key={`${keyPrefix}${status.id}`}
      status={status}
      anchorPrefix={anchorPrefix}
      authorAvatarPath={authorAvatars[status.authorId]}
      canDelete={status.authorId === currentUserId || canModerate}
      myEconomyVote={votesByStatusId ? votesByStatusId[status.id] : undefined}
      {...cardProps}
    />
  )

  // Enquanto a primeira página de posts não chegou, o card intercalado não aparece: ele ficaria sob o spinner e
  // saltaria quando os posts entrassem (a exposição só começa junto com o conteúdo).
  // Campanhas intercaladas no feed: as banner+feed e, no modo "cards tardios" (ver CommunityDetail), os cards só de
  // feed. O formato "feed" é "card no feed da comunidade" (sem posição fixa prometida); o banner é do topo e nunca
  // entra aqui. Antes da 1ª página de posts nada é intercalado: ficaria sob o spinner e saltaria quando os posts
  // entrassem (a exposição só começa junto com o conteúdo).
  const inlineSlots = inlineFeedAds
  const feedWithAds = interleaveAds(
    visibleStatuses,
    loadingFeed && statuses.length === 0 ? NO_ADS : inlineSlots,
    inlineFirstAfter ? { firstAfter: inlineFirstAfter } : undefined
  )
  const featuredCount = visibleFeaturedStatuses.length
  // Candidatos do card "Em destaque": TODOS os destaques ainda válidos agora (a lista veio filtrada pelo servidor, mas o
  // tempo passa), em qualquer posição do feed -- o rodízio dá a cada um a mesma chance de exposição.
  const spotlightStatuses = visibleFeaturedStatuses
  const formLoading = (
    <div className="cd-form-loading" role="status" aria-label="Carregando formulário">
      <Spinner />
    </div>
  )
  const showEmptyFeed =
    tab === 'recent' &&
    !loadingFeed &&
    !feedError &&
    visibleStatuses.length === 0 &&
    !linkedStatus &&
    visibleUpcomingWorkouts.length === 0

  return (
    <>
      <SponsoredAdBanner ads={bannerAds} placement="community_banner" communityId={communityId} />
      {reserveBannerSlot && bannerAds.length === 0 && (
        <div className="sponsored-ad-banner-slot" aria-hidden="true" />
      )}

      {!formOpen && (
        <div className="cd-toolbar community-toolbar">
          <FeedTabs
            value={tab}
            onChange={changeTab}
            featuredCount={featuredCount}
            featuredMounted={featuredMounted}
          />
          {canPost && (
            <div className="cd-actions community-publish-actions">
              <Button
                leadingVisual={PlusIcon}
                variant="primary"
                block
                className="cd-publish"
                onClick={() => setFormOpen('status')}
                onPointerEnter={warmForms}
                onTouchStart={warmForms}
                onFocus={warmForms}
              >
                Publicar
              </Button>
              <button
                type="button"
                className="cd-secondary"
                onClick={() => setFormOpen('progress')}
              >
                <GraphIcon size={16} />
                <span>Compartilhar progresso</span>
                <ChevronRightIcon size={16} />
              </button>
            </div>
          )}
        </div>
      )}
      {!canPost && <p className="cd-note">Somente o superadmin pode publicar nesta comunidade.</p>}
      {canPost && formOpen === 'progress' && (
        <LazyDialogBoundary onFail={() => setFormOpen(false)} fallback={formLoading}>
          <CommunityProgressShare
            onCreateStatus={onCreateStatus}
            onClose={() => setFormOpen(false)}
          />
        </LazyDialogBoundary>
      )}
      {canPost && formOpen === 'status' && (
        <LazyDialogBoundary onFail={() => setFormOpen(false)} fallback={formLoading}>
          <StatusForm
            communityId={communityId}
            author={author}
            onSubmit={onCreateStatus}
            onCancel={() => setFormOpen(false)}
          />
        </LazyDialogBoundary>
      )}

      <div
        id="cd-feed-panel-recent"
        role="tabpanel"
        aria-labelledby="cd-tab-recent"
        hidden={tab !== 'recent'}
      >
        {feedAds.length > 0 ? (
          <div className="community-feed sponsored-ad-feed-top" ref={topAdsRef}>
            {feedAds.map((ad) => (
              <SponsoredAdCard key={ad.id} ad={ad} communityId={communityId} />
            ))}
          </div>
        ) : (
          reserveFeedTopPx > 0 && (
            <div
              className="sponsored-ad-feed-top"
              style={{ height: reserveFeedTopPx }}
              aria-hidden="true"
            />
          )
        )}

        {/* Destaque compacto: uma linha, logo no começo de "Recentes" (antes de "Próximos treinos", que pode ter
            vários cards altos). Ver FeaturedSpotlight. */}
        {spotlightStatuses.length > 0 && (
          <FeaturedSpotlight statuses={spotlightStatuses} onOpen={openFeatured} />
        )}

        {/* Treino Marcado V1: seção própria, nunca misturada com Destaques -- Destaques é sobre posts
            PROMOVIDOS (pagos), "Próximos treinos" é sobre DATA (workout.date > agora), critérios
            independentes. Fica entre os anúncios/toolbar e o feed: são eventos acionáveis (data/hora
            reais, "Vou participar" com prazo), então ficam mais perto do topo de prioridade da página. A
            própria view remove duplicatas entre esta seção e o feed normal. */}
        {(visibleUpcomingWorkouts.length > 0 ||
          loadingUpcomingWorkouts ||
          upcomingWorkoutsError) && (
          <section className="community-feed-group community-upcoming-section">
            <h2>Próximos treinos</h2>
            {loadingUpcomingWorkouts && visibleUpcomingWorkouts.length === 0 && (
              <Spinner
                aria-label="Carregando próximos treinos"
                sx={{ display: 'block', mx: 'auto', my: 3 }}
              />
            )}
            <ErrorState error={upcomingWorkoutsError} onRetry={refreshFeed} />
            <div className="community-feed">
              {visibleUpcomingWorkouts.map((status) => renderCard(status, 'upcoming-'))}
            </div>
          </section>
        )}

        {linkedStatus && (
          <section className="community-feed-group community-linked-section">
            <h2>Publicação do link</h2>
            <div className="community-feed">{renderCard(linkedStatus)}</div>
          </section>
        )}

        <>
          {loadingFeed && statuses.length === 0 && (
            <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />
          )}
          <ErrorState error={feedError} onRetry={refreshFeed} />

          {showEmptyFeed && (
            <div className="cd-empty">
              <MegaphoneIcon size={20} />
              <p>Nenhuma publicação por aqui ainda.</p>
              <p className="cd-empty-hint">Seja o primeiro a publicar algo nesta comunidade.</p>
            </div>
          )}

          {/* Campanha contratada também no banner: o card entra no meio do feed (depois de algumas
              publicações), nunca colado ao banner do topo. Ver interleaveAds. */}
          <div className="community-feed">
            {feedWithAds.map((entry) =>
              entry.type === 'ad' ? (
                <SponsoredAdCard
                  key={`ad-${entry.ad.id}`}
                  ad={entry.ad}
                  communityId={communityId}
                />
              ) : (
                renderCard(entry.item)
              )
            )}
          </div>

          {!feedError && (
            <FeedPager
              hasMore={hasMore}
              loadingMore={loadingMore}
              moreError={moreError}
              onLoadMore={loadMore}
              count={statuses.length}
            />
          )}
        </>
      </div>
      {featuredMounted && (
        <div
          id="cd-feed-panel-featured"
          role="tabpanel"
          aria-labelledby="cd-tab-featured"
          hidden={tab !== 'featured'}
        >
          <section className="community-feed-group community-featured-section">
            {/* recordPromotionClick (clique, ver Communities.jsx) não é disparado aqui de propósito: um
                StatusCard já renderiza o conteúdo inteiro inline (texto, enquete, foto...), não existe um
                único "abrir" que leve a outro lugar. V1 fica sem métrica de clique para posts promovidos;
                só cliques em comunidades em destaque são contados. */}
            {featuredCount === 0 ? (
              <div className="cd-empty">
                <StarIcon size={20} />
                <p>Nenhuma publicação em destaque no momento.</p>
              </div>
            ) : (
              <div className="community-feed">
                {visibleFeaturedStatuses.map((status) =>
                  renderCard(status, 'featured-', 'destaque-')
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  )
}

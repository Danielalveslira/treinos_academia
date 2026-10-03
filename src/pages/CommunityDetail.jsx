import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Box, Heading, Text, Button, Spinner, Link } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  ChevronLeftIcon,
  MegaphoneIcon,
  PlusIcon,
  PeopleIcon,
  GraphIcon,
  GearIcon,
} from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useCommunityFeed } from '../hooks/useCommunityFeed'
import { useUpcomingWorkouts } from '../hooks/useUpcomingWorkouts'
import { useSponsoredAds } from '../hooks/useSponsoredAds'
import { useMyEconomyVotes } from '../hooks/useMyEconomyVotes'
import { useCommunityAuthorAvatars } from '../hooks/useCommunityAuthorAvatars'
import { useToast } from '../hooks/useToast'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import {
  getCommunity,
  updateCommunity,
  setCommunityActive,
  deleteCommunity,
} from '../services/communitiesService'
import { isMember, joinCommunity, leaveCommunity } from '../services/communityMembersService'
import { CommunityForm } from '../components/CommunityForm'
import { CommunityMembersModeration } from '../components/CommunityMembersModeration'
import { canModerateCommunity } from '../utils/communityOwnership'
import {
  createPhotoStatus,
  createTextStatus,
  createPollStatus,
  createWorkoutStatus,
  getSharedStatus,
} from '../services/statusesService'
import { describeQueryError } from '../utils/queryError'
import { invalidateCommunitiesCache } from '../utils/pageCache'
import { CommunityProgressShare } from '../components/CommunityProgressShare'
import { StatusForm } from '../components/StatusForm'
import { StatusCard } from '../components/StatusCard'
import { SponsoredAdCard } from '../components/SponsoredAdCard'
import { SponsoredAdBanner } from '../components/SponsoredAdBanner'
import { PromoteDialog } from '../components/PromoteDialog'
import { PromotedBadge } from '../components/PromotedBadge'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { listFeaturedStatusesForCommunity } from '../services/promotionsService'
import { toMillis } from '../utils/expiry.js'
import { expiresAtForRetention } from '../utils/postRetention'
import { applyEconomyVoteCountDeltaToList } from '../utils/economyVoteCountDelta'
import { publicationIdFromHash } from '../utils/share'
import { isStatusLoaded } from '../utils/sharedStatus'


// View pura (sem hooks de dados) separada do wrapper que busca os dados de verdade --
// mesmo padrão de WalletHeaderBadgesView/PromoteDialogBody: testável só com props.
// Reordena a composição da comunidade (não a lógica): criação de conteúdo + publicidade
// (toolbar de Publicações, banner e feedAds) vêm antes de Destaques, que por sua vez vêm
// antes do feed normal -- assim a quantidade de posts destacados (até FEATURED_LIMIT, ver
// promotionsService.js) nunca empurra o botão "+ Publicar" ou os anúncios pra baixo.
// featuredStatuses, statuses, feedAds e bannerAds continuam vindo exatamente de onde já
// vinham (useCommunityFeed/useSponsoredAds/listFeaturedStatusesForCommunity, em
// CommunityDetail); esta função só decide ONDE cada bloco aparece na página.
export function CommunityFeedSection({
  communityId,
  communityName,
  currentUserId,
  author,
  canModerate,
  canPost,
  bannerAds,
  feedAds,
  upcomingWorkouts = [],
  sharedStatus = null,
  loadingUpcomingWorkouts = false,
  upcomingWorkoutsError = null,
  featuredStatuses,
  statuses,
  authorAvatars = {},
  loadingFeed,
  feedError,
  formOpen,
  setFormOpen,
  refreshFeed,
  now,
  showToast,
  votesByStatusId,
  setVote,
  onEconomyVoted,
  onDeleteStatus,
  onCreateStatus,
  onPromoted,
}) {
  const currentTime = toMillis(now) || Date.now()
  // Publicação alvo de um link (resolvida por ID quando fora da 1ª página do feed): um treino
  // futuro entra em "Próximos treinos"; qualquer outra (ou treino já passado) ganha bloco próprio.
  const workoutCandidates =
    sharedStatus?.type === 'workout' ? [sharedStatus, ...upcomingWorkouts] : upcomingWorkouts
  const visibleUpcomingWorkouts = workoutCandidates.filter(
    (status, index, items) =>
      toMillis(status.workout?.date) > currentTime &&
      items.findIndex((candidate) => candidate.id === status.id) === index
  )
  const upcomingWorkoutIds = new Set(visibleUpcomingWorkouts.map((status) => status.id))
  const visibleFeaturedStatuses = featuredStatuses.filter(
    (status) => !upcomingWorkoutIds.has(status.id)
  )
  const visibleStatuses = statuses.filter((status) => !upcomingWorkoutIds.has(status.id))
  const linkedStatus =
    sharedStatus &&
    !isStatusLoaded(
      sharedStatus.id,
      visibleUpcomingWorkouts,
      visibleFeaturedStatuses,
      visibleStatuses
    )
      ? sharedStatus
      : null

  return (
    <>
      <SponsoredAdBanner ads={bannerAds} />

      {!formOpen && (
        <Box className="community-toolbar">
          <Heading as="h2">Publicações</Heading>
          <Box className="community-publish-actions">
            <Button onClick={refreshFeed} loading={loadingFeed} disabled={loadingFeed}>
              Atualizar
            </Button>
            {canPost && (
              <>
                <Button
                  leadingVisual={PlusIcon}
                  variant="primary"
                  onClick={() => setFormOpen('status')}
                >
                  Publicar
                </Button>
                <Button leadingVisual={GraphIcon} onClick={() => setFormOpen('progress')}>
                  Compartilhar progresso
                </Button>
              </>
            )}
          </Box>
        </Box>
      )}
      {!canPost && (
        <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 1, mb: 3 }}>
          Somente o superadmin pode publicar nesta comunidade.
        </Text>
      )}
      {canPost && formOpen === 'progress' && (
        <CommunityProgressShare onCreateStatus={onCreateStatus} onClose={() => setFormOpen(false)} />
      )}
      {canPost && formOpen === 'status' && (
        <StatusForm
          communityId={communityId}
          author={author}
          onSubmit={onCreateStatus}
          onCancel={() => setFormOpen(false)}
        />
      )}

      {feedAds.length > 0 && (
        <div className="community-feed">
          {feedAds.map((ad) => (
            <SponsoredAdCard key={ad.id} ad={ad} />
          ))}
        </div>
      )}

      {/* Treino Marcado V1: seção própria, nunca misturada com Destaques -- Destaques é
          sobre posts PROMOVIDOS (pagos), "Próximos treinos" é sobre DATA (workout.date >
          agora), critérios independentes. Fica entre os anúncios/toolbar e Destaques:
          são eventos acionáveis (data/hora reais, "Vou participar" com prazo), então
          ficam mais perto do topo de prioridade da página (mesmo raciocínio da
          reordenação anterior: ação real antes de conteúdo em destaque). A própria view
          remove duplicatas entre esta seção, Destaques e o feed normal. */}
      {(visibleUpcomingWorkouts.length > 0 || loadingUpcomingWorkouts || upcomingWorkoutsError) && (
        <Box as="section" className="community-feed-group community-upcoming-section">
          <Heading as="h2">Próximos treinos</Heading>
          {loadingUpcomingWorkouts && visibleUpcomingWorkouts.length === 0 && (
            <Spinner
              aria-label="Carregando próximos treinos"
              sx={{ display: 'block', mx: 'auto', my: 3 }}
            />
          )}
          <ErrorState error={upcomingWorkoutsError} onRetry={refreshFeed} />
          <div className="community-feed">
            {visibleUpcomingWorkouts.map((status) => (
              <StatusCard
                key={`upcoming-${status.id}`}
                status={status}
                authorAvatarPath={authorAvatars[status.authorId]}
                currentUserId={currentUserId}
                canDelete={status.authorId === currentUserId || canModerate}
                canModerate={canModerate}
                onDelete={onDeleteStatus}
                now={now}
                communityName={communityName}
                showToast={showToast}
                myEconomyVote={votesByStatusId ? (votesByStatusId[status.id] ?? null) : undefined}
                onEconomyVoted={(value, delta) => {
                  setVote(status.id, value)
                  onEconomyVoted(status.id, delta)
                }}
              />
            ))}
          </div>
        </Box>
      )}

      {linkedStatus && (
        <Box as="section" className="community-feed-group community-linked-section">
          <Heading as="h2">Publicação do link</Heading>
          <div className="community-feed">
            <StatusCard
              status={linkedStatus}
              authorAvatarPath={authorAvatars[linkedStatus.authorId]}
              currentUserId={currentUserId}
              canDelete={linkedStatus.authorId === currentUserId || canModerate}
              canModerate={canModerate}
              onDelete={onDeleteStatus}
              now={now}
              communityName={communityName}
              showToast={showToast}
              myEconomyVote={
                votesByStatusId ? (votesByStatusId[linkedStatus.id] ?? null) : undefined
              }
              onEconomyVoted={(value, delta) => {
                setVote(linkedStatus.id, value)
                onEconomyVoted(linkedStatus.id, delta)
              }}
              onPromoted={onPromoted}
            />
          </div>
        </Box>
      )}

      {visibleFeaturedStatuses.length > 0 && (
        <Box as="section" className="community-feed-group community-featured-section">
          <Heading as="h2">Destaques</Heading>
          {/* recordPromotionClick (clique, ver Communities.jsx) não é disparado aqui de
              propósito: um StatusCard já renderiza o conteúdo inteiro inline (texto,
              enquete, foto...), não existe um único "abrir" que leve a outro lugar --
              diferente de CommunityRow, cujo link inteiro navega para /comunidades/{id}.
              V1 fica sem métrica de clique para posts promovidos; só cliques em
              comunidades em destaque são contados. */}
          <div className="community-feed">
            {visibleFeaturedStatuses.map((status) => (
              <StatusCard
                key={`featured-${status.id}`}
                status={status}
                authorAvatarPath={authorAvatars[status.authorId]}
                currentUserId={currentUserId}
                canDelete={status.authorId === currentUserId || canModerate}
                canModerate={canModerate}
                onDelete={onDeleteStatus}
                now={now}
                communityName={communityName}
                showToast={showToast}
                myEconomyVote={votesByStatusId ? (votesByStatusId[status.id] ?? null) : undefined}
                onEconomyVoted={(value, delta) => {
                  setVote(status.id, value)
                  onEconomyVoted(status.id, delta)
                }}
              />
            ))}
          </div>
        </Box>
      )}

      {loadingFeed && statuses.length === 0 && (
        <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />
      )}
      <ErrorState error={feedError} onRetry={refreshFeed} />

      {!loadingFeed && !feedError && visibleStatuses.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <MegaphoneIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhuma publicação nas últimas 24h</Blankslate.Heading>
          <Blankslate.Description>
            Seja o primeiro a publicar algo nesta comunidade.
          </Blankslate.Description>
        </Blankslate>
      )}

      <div className="community-feed">
        {visibleStatuses.map((status) => (
          <StatusCard
            key={status.id}
            status={status}
            authorAvatarPath={authorAvatars[status.authorId]}
            currentUserId={currentUserId}
            canDelete={status.authorId === currentUserId || canModerate}
            canModerate={canModerate}
            onDelete={onDeleteStatus}
            now={now}
            communityName={communityName}
            showToast={showToast}
            myEconomyVote={votesByStatusId ? (votesByStatusId[status.id] ?? null) : undefined}
            onEconomyVoted={(value, delta) => {
              setVote(status.id, value)
              onEconomyVoted(status.id, delta)
            }}
            onPromoted={onPromoted}
          />
        ))}
      </div>
    </>
  )
}

function CommunityDetail({ id }) {
  const navigate = useNavigate()
  const { user, profile, isSuperAdmin } = useAuth()
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()

  const [community, setCommunity] = useState(null)
  const [member, setMember] = useState(false)
  const [membershipPending, setMembershipPending] = useState(false)
  const [loadingCommunity, setLoadingCommunity] = useState(true)
  const [communityError, setCommunityError] = useState(null)
  const { hash } = useLocation()
  const [sharedStatus, setSharedStatus] = useState(null)
  const sharedStatusRequested = useRef('')
  const sharedAnchorScrolled = useRef('')
  const [formOpen, setFormOpen] = useState(false)
  const [managing, setManaging] = useState(false)

  const {
    statuses,
    loading: loadingFeed,
    error: feedError,
    refresh: refreshFeed,
    addStatusLocally,
    remove,
    updateEconomyVoteCounts,
    updatePostPromotion,
    now,
  } = useCommunityFeed(id, member)

  const {
    workouts: upcomingWorkouts,
    loading: loadingUpcomingWorkouts,
    error: upcomingWorkoutsError,
    refresh: refreshUpcomingWorkouts,
    setWorkouts: setUpcomingWorkouts,
  } = useUpcomingWorkouts(id, member)

  // enabled=member: só busca depois de confirmar participação, nunca antes -- ver
  // comentário em useSponsoredAds.js sobre por que isso é obrigatório, não só uma
  // otimização.
  const { feedAds, bannerAds } = useSponsoredAds(id, member)

  // Fase 6 -- "destaques" (posts promovidos com EvoCash) precisam de uma consulta
  // própria porque o feed normal só cobre a janela de retenção da comunidade (24h, 30d); uma
  // promoção de 7/30 dias precisa continuar visível bem depois disso. Filtrado no
  // servidor por promotedUntil > agora (nunca limit() antes de tirar os expirados, ver
  // promotionsService.js) -- nunca lê promotions/{id} pra isto.
  const [featuredStatuses, setFeaturedStatuses] = useState([])
  const [featuredLoaded, setFeaturedLoaded] = useState(false)
  const [promoteCommunityOpen, setPromoteCommunityOpen] = useState(false)
  useEffect(() => {
    if (!member) return
    let active = true
    setFeaturedLoaded(false)
    listFeaturedStatusesForCommunity(id)
      .then((items) => {
        if (active) setFeaturedStatuses(items)
      })
      .catch((err) => console.error('[CommunityDetail] listFeaturedStatusesForCommunity:', err))
      .finally(() => {
        if (active) setFeaturedLoaded(true)
      })
    return () => {
      active = false
    }
  }, [id, member])

  // 1 consulta para o feed inteiro (nunca 1 leitura por card) -- ver useMyEconomyVotes.js.
  // Inclui destaques elegíveis: um post promovido pode estar fora da janela de 24h do
  // feed normal. Poll e workout são excluídos porque nenhum deles possui voto econômico.
  const statusIds = member
    ? [
        ...new Set(
          [...statuses, ...featuredStatuses, ...(sharedStatus ? [sharedStatus] : [])]
            .filter((status) => status.type !== 'poll' && status.type !== 'workout')
            .map((status) => status.id)
        ),
      ]
    : []
  const { votesByStatusId, setVote } = useMyEconomyVotes(statusIds, user?.uid)
  const authorAvatars = useCommunityAuthorAvatars(
    member,
    statuses,
    featuredStatuses,
    upcomingWorkouts,
    sharedStatus ? [sharedStatus] : []
  )

  // Um mesmo post pode aparecer duas vezes na tela (card normal em `statuses` + cópia
  // destacada em `featuredStatuses`, ver Fase 6) -- um único handler aplica o mesmo
  // delta nos dois lugares onde o statusId existir, pra nunca deixar uma cópia com o
  // número antigo enquanto a outra já atualizou.
  function handleEconomyVoted(statusId, delta) {
    updateEconomyVoteCounts(statusId, delta)
    setFeaturedStatuses((prev) => applyEconomyVoteCountDeltaToList(prev, statusId, delta))
  }

  const refreshCommunityContent = useCallback(
    () => Promise.all([refreshFeed(), refreshUpcomingWorkouts()]),
    [refreshFeed, refreshUpcomingWorkouts]
  )

  // Link para uma publicação (#treino-{id} / #publicacao-{id}): primeiro procura nas listas já
  // carregadas; só se ela não estiver lá (fora da 1ª página do feed, expirada etc.) faz UMA
  // leitura por ID canônico -- nunca carrega páginas anteriores nem o feed inteiro.
  const sharedStatusId = publicationIdFromHash(hash)
  useEffect(() => {
    setSharedStatus(null)
    sharedStatusRequested.current = ''
    sharedAnchorScrolled.current = ''
  }, [id, sharedStatusId])

  const feedSettled = member && !loadingFeed && !loadingUpcomingWorkouts && featuredLoaded
  useEffect(() => {
    if (!feedSettled || !sharedStatusId) return
    if (isStatusLoaded(sharedStatusId, statuses, featuredStatuses, upcomingWorkouts)) return
    if (sharedStatusRequested.current === sharedStatusId) return

    sharedStatusRequested.current = sharedStatusId
    getSharedStatus(sharedStatusId, id)
      .then((status) => {
        if (sharedStatusRequested.current === sharedStatusId) setSharedStatus(status)
      })
      .catch((error) => console.error('[CommunityDetail] getSharedStatus:', error))
  }, [feedSettled, sharedStatusId, id, statuses, featuredStatuses, upcomingWorkouts])

  useEffect(() => {
    if (!member || !sharedStatusId) return undefined
    const anchor = hash.slice(1)
    if (sharedAnchorScrolled.current === anchor) return undefined
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(anchor)
      if (!element) return
      sharedAnchorScrolled.current = anchor
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [member, hash, sharedStatusId, sharedStatus, upcomingWorkouts, featuredStatuses, statuses])

  const loadCommunity = useCallback(async () => {
    setLoadingCommunity(true)
    setCommunityError(null)
    try {
      const [data, memberFlag] = await Promise.all([getCommunity(id), isMember(id, user.uid)])
      setCommunity(data)
      setMember(memberFlag)
    } catch (err) {
      setCommunityError(describeQueryError(err, 'CommunityDetail'))
    } finally {
      setLoadingCommunity(false)
    }
  }, [id, user.uid])

  useEffect(() => {
    loadCommunity()
  }, [loadCommunity])

  // A guarda contra clique duplo evita dois efeitos: uma segunda escrita inútil (RLS não
  // tem nenhuma policy de update em community_members, então isso nunca corrompe dado
  // nenhum) e, principalmente, o falso "Erro ao entrar/sair" que aparecia quando
  // o segundo clique chegava depois do primeiro já ter concluído.
  async function handleJoin() {
    if (membershipPending) return
    setMembershipPending(true)
    try {
      await joinCommunity(id, user.uid)
      setMember(true)
      showToast('Você entrou na comunidade.')
    } catch (err) {
      console.error('[CommunityDetail] join:', err)
      showToast('Erro ao entrar na comunidade.', 'danger')
    } finally {
      setMembershipPending(false)
    }
  }

  async function handleLeave() {
    if (membershipPending) return
    setMembershipPending(true)
    try {
      await leaveCommunity(id, user.uid)
      setMember(false)
      showToast('Você saiu da comunidade.')
    } catch (err) {
      console.error('[CommunityDetail] leave:', err)
      showToast('Erro ao sair da comunidade.', 'danger')
    } finally {
      setMembershipPending(false)
    }
  }

  // Fase 5: mesmas funções de communitiesService.js já usadas pelo painel admin --
  // funcionam para o dono porque a policy communities_update agora aceita
  // is_community_owner() ao lado de is_superadmin(), não porque este código sabe algo
  // novo.
  async function handleUpdateCommunity(values) {
    try {
      await updateCommunity(id, values)
      setCommunity((previous) => ({ ...previous, ...values }))
      invalidateCommunitiesCache(user.uid)
      setManaging(false)
      showToast('Comunidade atualizada.')
    } catch (err) {
      console.error('[CommunityDetail] updateCommunity:', err)
      showToast('Erro ao atualizar a comunidade.', 'danger')
      throw err
    }
  }

  async function handleToggleActive() {
    try {
      await setCommunityActive(id, !community.isActive)
      setCommunity((previous) => ({ ...previous, isActive: !previous.isActive }))
      invalidateCommunitiesCache(user.uid)
      showToast(community.isActive ? 'Comunidade desativada.' : 'Comunidade reativada.')
    } catch (err) {
      console.error('[CommunityDetail] setCommunityActive:', err)
      showToast('Erro ao alterar o status da comunidade.', 'danger')
    }
  }

  async function handleDeleteCommunity() {
    const confirmed = await confirmDelete({
      title: 'Excluir esta comunidade?',
      content:
        'Publicações, membros e restrições dela serão apagados. Esta ação não pode ser desfeita.',
    })
    if (!confirmed) return
    try {
      await deleteCommunity(id)
      invalidateCommunitiesCache(user.uid)
      showToast('Exclusão da comunidade solicitada.')
      navigate('/comunidades', { replace: true })
    } catch (err) {
      console.error('[CommunityDetail] deleteCommunity:', err)
      showToast('Erro ao excluir a comunidade.', 'danger')
    }
  }

  async function handleCreateStatus(values) {
    const author = { id: user.uid, username: profile?.username || null, role: profile?.role }
    const authorIsSuperAdmin = author.role === 'superadmin'
    // Só para o post otimista: o prazo real (e a regra guardada no post) vêm do banco.
    const retentionMode = community?.postRetentionMode || '24h'
    const expiresAt = expiresAtForRetention(retentionMode)
    try {
      if (values.type === 'progress') {
        // Card de progresso = foto normal da comunidade (mesmo bucket/pipeline/policies) + metadado de progresso.
        const { done } = await createPhotoStatus(id, author, {
          blob: values.blob,
          caption: values.caption,
          progress: values.progress,
        })
        const ref = await done
        addStatusLocally({
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
          authorIsSuperAdmin,
          type: 'photo',
          photoPath: `statusPhotos/${id}/${ref.id}.webp`,
          caption: values.caption ? values.caption.trim() : '',
          progress: values.progress,
          _localPhotoBlob: values.blob,
          createdAt: new Date(),
          expiresAt,
          retentionMode,
        })
      } else if (values.type === 'text') {
        const ref = await createTextStatus(id, author, values.text)
        addStatusLocally({
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
          authorIsSuperAdmin,
          type: 'text',
          text: values.text.trim(),
          createdAt: new Date(),
          expiresAt,
          retentionMode,
        })
      } else if (values.type === 'poll') {
        const ref = await createPollStatus(id, author, values.question, values.options)
        addStatusLocally({
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
          authorIsSuperAdmin,
          type: 'poll',
          poll: {
            question: values.question.trim(),
            options: values.options.map((label, index) => ({ id: String(index), label })),
          },
          createdAt: new Date(),
          expiresAt,
          retentionMode,
        })
      } else if (values.type === 'workout') {
        const ref = await createWorkoutStatus(id, author, values)
        const workoutStatus = {
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
          authorIsSuperAdmin,
          type: 'workout',
          workout: {
            title: values.title.trim(),
            date: new Date(values.date),
            location: values.location.trim(),
          },
          createdAt: new Date(),
          expiresAt,
          retentionMode,
        }
        addStatusLocally(workoutStatus)
        setUpcomingWorkouts(
          [workoutStatus, ...upcomingWorkouts]
            .filter(
              (status, index, items) =>
                items.findIndex((candidate) => candidate.id === status.id) === index
            )
            .sort((left, right) => toMillis(left.workout.date) - toMillis(right.workout.date))
            .slice(0, 20)
        )
      } else if (values.type === 'photo') {
        // O upload e a criação do documento já aconteceram dentro do StatusForm (é
        // quem controla o progresso/cancelamento) — aqui só sobra atualizar o feed
        // local. _localPhotoBlob deixa o StatusCard mostrar a própria foto na hora,
        // sem baixar de novo algo que o navegador já tem em memória.
        addStatusLocally({
          id: values.ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
          authorIsSuperAdmin,
          type: 'photo',
          photoPath: `statusPhotos/${id}/${values.ref.id}.webp`,
          caption: values.caption ? values.caption.trim() : '',
          _localPhotoBlob: values.blob,
          createdAt: new Date(),
          expiresAt,
          retentionMode,
        })
      }
      setFormOpen(false)
      showToast(values.type === 'progress' ? 'Progresso publicado na comunidade.' : 'Publicado na comunidade.')
    } catch (err) {
      console.error('[CommunityDetail] createStatus:', err)
      showToast('Erro ao publicar.', 'danger')
      throw err
    }
  }

  async function handleDeleteStatus(status) {
    const confirmed = await confirmDelete({
      title: 'Excluir esta publicação?',
      content: 'Esta ação não pode ser desfeita.',
    })
    if (!confirmed) return false
    try {
      await remove(status.id)
      setUpcomingWorkouts(upcomingWorkouts.filter((item) => item.id !== status.id))
      setSharedStatus((item) => (item?.id === status.id ? null : item))
      setFeaturedStatuses((items) => items.filter((item) => item.id !== status.id))
      showToast('Publicação excluída.')
      return true
    } catch (err) {
      console.error('[CommunityDetail] delete:', err)
      throw new Error('Não foi possível excluir a publicação.', { cause: err })
    }
  }

  const loading = loadingCommunity || loadingFeed
  // Fase 5: dono da comunidade conta como moderador só DENTRO dela -- nunca em nenhuma
  // outra (mesma condição is_community_owner() usada nas policies). community?.ownerId
  // já vem do próprio getCommunity(id) acima, sem leitura extra.
  const canModerate = canModerateCommunity({
    isSuperAdmin,
    communityOwnerId: community?.ownerId,
    uid: user.uid,
  })
  const canPost = canModerate || community?.postAccess !== 'admins'

  return (
    <Box className="community-page">
      <ToastFlash toasts={toasts} />
      <Link as={RouterLink} to="/comunidades" className="community-back">
        <ChevronLeftIcon /> Comunidades
      </Link>
      <nav className="community-legal-links" aria-label="Convivência na comunidade">
        <Link as={RouterLink} to="/regras-da-comunidade">
          Regras da Comunidade
        </Link>
        <Link as={RouterLink} to={`/atendimento?tipo=report&comunidade=${encodeURIComponent(id)}`}>
          Denunciar violação
        </Link>
      </nav>

      {loadingCommunity && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={communityError} onRetry={loadCommunity} />

      {!loadingCommunity && !communityError && community && (
        <>
          <Box className="community-heading">
            <Box sx={{ minWidth: 0 }}>
              <Heading as="h1">{community.name}</Heading>
              {Boolean(community.promoted) &&
                toMillis(community.promotedUntil) > toMillis(new Date()) && <PromotedBadge />}
              {community.description && (
                <Text as="p" className="community-description">
                  {community.description}
                </Text>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              {canModerate && !managing && (
                <Button leadingVisual={GearIcon} onClick={() => setManaging(true)}>
                  Gerenciar
                </Button>
              )}
              {member && (
                <Button onClick={handleLeave} disabled={membershipPending}>
                  Sair
                </Button>
              )}
            </Box>
          </Box>

          {/* Fase 5: visível para isSuperAdmin || dono (ownerId) -- as MESMAS
              funções de communitiesService.js que o painel admin global já usa, só que
              aqui restritas (pelas Rules, não só pela UI) a esta comunidade. */}
          {canModerate && managing && (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'border.default',
                borderRadius: 2,
                p: 3,
                mb: 3,
              }}
            >
              <Heading as="h2" sx={{ fontSize: 1, mb: 2 }}>
                Gerenciar comunidade
              </Heading>
              <CommunityForm
                initialValue={community}
                onSubmit={handleUpdateCommunity}
                onCancel={() => setManaging(false)}
              />
              <Box
                sx={{
                  display: 'flex',
                  gap: 2,
                  mt: 3,
                  borderTop: '1px solid',
                  borderColor: 'border.default',
                  pt: 3,
                }}
              >
                <Button onClick={handleToggleActive}>
                  {community.isActive ? 'Desativar comunidade' : 'Reativar comunidade'}
                </Button>
                <Button variant="danger" onClick={handleDeleteCommunity}>
                  Excluir comunidade
                </Button>
              </Box>
              {/* Fase 6: promoção paga é uma decisão do DONO, nunca do superadmin agindo
                  como moderador -- diferente de canModerate acima, checa ownerId direto. */}
              {community.ownerId === user.uid && !community.promoted && (
                <Box sx={{ mt: 3, borderTop: '1px solid', borderColor: 'border.default', pt: 3 }}>
                  <Button onClick={() => setPromoteCommunityOpen(true)}>Promover comunidade</Button>
                </Box>
              )}
              <Box sx={{ mt: 3, borderTop: '1px solid', borderColor: 'border.default', pt: 3 }}>
                <Heading as="h3" sx={{ fontSize: 0, mb: 2 }}>
                  Membros e banimentos
                </Heading>
                <CommunityMembersModeration communityId={id} />
              </Box>
            </Box>
          )}
          {promoteCommunityOpen && (
            <PromoteDialog
              targetType="community"
              targetId={id}
              currentUserId={user.uid}
              title="Promover comunidade"
              onClose={() => setPromoteCommunityOpen(false)}
              onPromoted={() => {
                setPromoteCommunityOpen(false)
                loadCommunity()
              }}
            />
          )}

          {!member && (
            <Blankslate>
              <Blankslate.Visual>
                <PeopleIcon size={24} />
              </Blankslate.Visual>
              <Blankslate.Heading>Entre para ver o feed</Blankslate.Heading>
              <Blankslate.Description>
                Só membros podem ver e publicar conteúdos nesta comunidade.
              </Blankslate.Description>
              <Blankslate.PrimaryAction onClick={handleJoin} disabled={membershipPending}>
                Entrar
              </Blankslate.PrimaryAction>
            </Blankslate>
          )}

          {member && (
            <CommunityFeedSection
              communityId={id}
              communityName={community.name}
              currentUserId={user.uid}
              author={{ id: user.uid, username: profile?.username || null, role: profile?.role }}
              canModerate={canModerate}
              canPost={canPost}
              bannerAds={bannerAds}
              feedAds={feedAds}
              upcomingWorkouts={upcomingWorkouts}
              sharedStatus={sharedStatus}
              loadingUpcomingWorkouts={loadingUpcomingWorkouts}
              upcomingWorkoutsError={upcomingWorkoutsError}
              featuredStatuses={featuredStatuses}
              statuses={statuses}
              authorAvatars={authorAvatars}
              loadingFeed={loadingFeed || loadingUpcomingWorkouts}
              feedError={feedError}
              formOpen={formOpen}
              setFormOpen={setFormOpen}
              refreshFeed={refreshCommunityContent}
              now={now}
              showToast={showToast}
              votesByStatusId={votesByStatusId}
              setVote={setVote}
              onEconomyVoted={handleEconomyVoted}
              onDeleteStatus={handleDeleteStatus}
              onCreateStatus={handleCreateStatus}
              onPromoted={(statusId, result) =>
                updatePostPromotion(statusId, { promoted: true, promotedUntil: result.expiresAtMs })
              }
            />
          )}
        </>
      )}

      {!loading && !communityError && !community && (
        <Blankslate>
          <Blankslate.Visual>
            <PeopleIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Comunidade não encontrada</Blankslate.Heading>
          <Blankslate.PrimaryAction onClick={() => navigate('/comunidades', { replace: true })}>
            Voltar
          </Blankslate.PrimaryAction>
        </Blankslate>
      )}
    </Box>
  )
}

export default function CommunityDetailRoute() {
  const { id } = useParams()
  return <CommunityDetail key={id} id={id} />
}

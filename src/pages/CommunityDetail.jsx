import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { Box, Heading, Text, Button, Spinner, Link } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  ChevronLeftIcon,
  MegaphoneIcon,
  PlusIcon,
  PeopleIcon,
  TrophyIcon,
  GearIcon,
} from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useCommunityFeed } from '../hooks/useCommunityFeed'
import { useSponsoredAds } from '../hooks/useSponsoredAds'
import { useMyEconomyVotes } from '../hooks/useMyEconomyVotes'
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
  createAchievementStatus,
  createTextStatus,
  createPollStatus,
  createWorkoutStatus,
} from '../services/statusesService'
import { describeFirestoreError } from '../utils/firestoreError'
import { invalidateCommunitiesCache } from '../utils/pageCache'
import { AchievementForm } from '../components/AchievementForm'
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
import { applyEconomyVoteCountDeltaToList } from '../utils/economyVoteCountDelta'

const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000

// View pura (sem hooks de Firestore) separada do wrapper que busca os dados de verdade --
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
  currentUserId,
  author,
  canModerate,
  canPost,
  bannerAds,
  feedAds,
  featuredStatuses,
  statuses,
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
                <Button leadingVisual={TrophyIcon} onClick={() => setFormOpen('achievement')}>
                  Conquista do dia
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
      {canPost && formOpen === 'achievement' && (
        <AchievementForm onSubmit={onCreateStatus} onCancel={() => setFormOpen(false)} />
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

      {featuredStatuses.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Heading as="h2" sx={{ fontSize: 1, mb: 2 }}>
            Destaques
          </Heading>
          {/* recordPromotionClick (clique, ver Communities.jsx) não é disparado aqui de
              propósito: um StatusCard já renderiza o conteúdo inteiro inline (texto,
              enquete, foto...), não existe um único "abrir" que leve a outro lugar --
              diferente de CommunityRow, cujo link inteiro navega para /comunidades/{id}.
              V1 fica sem métrica de clique para posts promovidos; só cliques em
              comunidades em destaque são contados. */}
          {featuredStatuses.map((status) => (
            <StatusCard
              key={`featured-${status.id}`}
              status={status}
              currentUserId={currentUserId}
              canDelete={status.authorId === currentUserId || canModerate}
              onDelete={onDeleteStatus}
              now={now}
              showToast={showToast}
              myEconomyVote={votesByStatusId ? (votesByStatusId[status.id] ?? null) : undefined}
              onEconomyVoted={(value, delta) => {
                setVote(status.id, value)
                onEconomyVoted(status.id, delta)
              }}
            />
          ))}
        </Box>
      )}

      {loadingFeed && statuses.length === 0 && (
        <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />
      )}
      <ErrorState error={feedError} onRetry={refreshFeed} />

      {!loadingFeed && !feedError && statuses.length === 0 && (
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
        {statuses.map((status) => (
          <StatusCard
            key={status.id}
            status={status}
            currentUserId={currentUserId}
            canDelete={status.authorId === currentUserId || canModerate}
            onDelete={onDeleteStatus}
            now={now}
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

  // enabled=member: só busca depois de confirmar participação, nunca antes -- ver
  // comentário em useSponsoredAds.js sobre por que isso é obrigatório, não só uma
  // otimização.
  const { feedAds, bannerAds } = useSponsoredAds(id, member)

  // Fase 6 -- "destaques" (posts promovidos com EvoCash) precisam de uma consulta
  // própria porque o feed normal só cobre as últimas 24h (STATUS_LIFETIME_MS); uma
  // promoção de 7/30 dias precisa continuar visível bem depois disso. Filtrado no
  // servidor por promotedUntil > agora (nunca limit() antes de tirar os expirados, ver
  // promotionsService.js) -- nunca lê promotions/{id} pra isto.
  const [featuredStatuses, setFeaturedStatuses] = useState([])
  const [promoteCommunityOpen, setPromoteCommunityOpen] = useState(false)
  useEffect(() => {
    if (!member) return
    let active = true
    listFeaturedStatusesForCommunity(id)
      .then((items) => {
        if (active) setFeaturedStatuses(items)
      })
      .catch((err) => console.error('[CommunityDetail] listFeaturedStatusesForCommunity:', err))
    return () => {
      active = false
    }
  }, [id, member])

  // 1 consulta para o feed inteiro (nunca 1 leitura por card) -- ver useMyEconomyVotes.js.
  // Inclui featuredStatuses também: um post promovido pode estar fora da janela de 24h
  // do feed normal, mas ainda precisa do próprio voto resolvido (senão EconomyVoteBar
  // ficaria "carregando" pra sempre nesse card).
  const statusIds = member
    ? [...new Set([...statuses, ...featuredStatuses].map((status) => status.id))]
    : []
  const { votesByStatusId, setVote } = useMyEconomyVotes(statusIds, user?.uid)

  // Um mesmo post pode aparecer duas vezes na tela (card normal em `statuses` + cópia
  // destacada em `featuredStatuses`, ver Fase 6) -- um único handler aplica o mesmo
  // delta nos dois lugares onde o statusId existir, pra nunca deixar uma cópia com o
  // número antigo enquanto a outra já atualizou.
  function handleEconomyVoted(statusId, delta) {
    updateEconomyVoteCounts(statusId, delta)
    setFeaturedStatuses((prev) => applyEconomyVoteCountDeltaToList(prev, statusId, delta))
  }

  const loadCommunity = useCallback(async () => {
    setLoadingCommunity(true)
    setCommunityError(null)
    try {
      const [data, memberFlag] = await Promise.all([getCommunity(id), isMember(id, user.uid)])
      setCommunity(data)
      setMember(memberFlag)
    } catch (err) {
      setCommunityError(describeFirestoreError(err, 'CommunityDetail'))
    } finally {
      setLoadingCommunity(false)
    }
  }, [id, user.uid])

  useEffect(() => {
    loadCommunity()
  }, [loadCommunity])

  // A guarda contra clique duplo evita dois efeitos: uma segunda escrita inútil (a
  // regra do Firestore já recusa update em communityMembers, então isso nunca corrompe
  // dado nenhum) e, principalmente, o falso "Erro ao entrar/sair" que aparecia quando
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
  // funcionam para o dono porque firestore.rules agora aceita isCommunityOwner nas
  // mesmas Rules que já aceitavam isSuperAdmin(), não porque este código sabe algo novo.
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
      content: 'Publicações, membros e restrições dela serão apagados. Esta ação não pode ser desfeita.',
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
    const expiresAt = new Date(Date.now() + STATUS_LIFETIME_MS)
    try {
      if (values.type === 'achievement') {
        const ref = await createAchievementStatus(id, author, values.achievement)
        addStatusLocally({
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
          authorIsSuperAdmin,
          type: 'achievement',
          achievement: values.achievement,
          createdAt: new Date(),
          expiresAt,
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
        })
      } else if (values.type === 'workout') {
        const ref = await createWorkoutStatus(id, author, values)
        addStatusLocally({
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
        })
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
        })
      }
      setFormOpen(false)
      showToast('Publicado na comunidade.')
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
    if (!confirmed) return
    try {
      await remove(status.id)
      showToast('Publicação excluída.')
    } catch (err) {
      console.error('[CommunityDetail] delete:', err)
      showToast('Erro ao excluir publicação.', 'danger')
    }
  }

  const loading = loadingCommunity || loadingFeed
  // Fase 5: dono da comunidade conta como moderador só DENTRO dela -- nunca em nenhuma
  // outra (ver firestore.rules: isCommunityOwner/statusCommunityOk). community?.ownerId
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
              {Boolean(community.promoted) && toMillis(community.promotedUntil) > toMillis(new Date()) && (
                <PromotedBadge />
              )}
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
              sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, mb: 3 }}
            >
              <Heading as="h2" sx={{ fontSize: 1, mb: 2 }}>
                Gerenciar comunidade
              </Heading>
              <CommunityForm
                initialValue={community}
                onSubmit={handleUpdateCommunity}
                onCancel={() => setManaging(false)}
              />
              <Box sx={{ display: 'flex', gap: 2, mt: 3, borderTop: '1px solid', borderColor: 'border.default', pt: 3 }}>
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
              currentUserId={user.uid}
              author={{ id: user.uid, username: profile?.username || null, role: profile?.role }}
              canModerate={canModerate}
              canPost={canPost}
              bannerAds={bannerAds}
              feedAds={feedAds}
              featuredStatuses={featuredStatuses}
              statuses={statuses}
              loadingFeed={loadingFeed}
              feedError={feedError}
              formOpen={formOpen}
              setFormOpen={setFormOpen}
              refreshFeed={refreshFeed}
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

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
} from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useCommunityFeed } from '../hooks/useCommunityFeed'
import { useSponsoredAds } from '../hooks/useSponsoredAds'
import { useToast } from '../hooks/useToast'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { getCommunity } from '../services/communitiesService'
import { isMember, joinCommunity, leaveCommunity } from '../services/communityMembersService'
import {
  createAchievementStatus,
  createTextStatus,
  createPollStatus,
  createWorkoutStatus,
} from '../services/statusesService'
import { describeFirestoreError } from '../utils/firestoreError'
import { AchievementForm } from '../components/AchievementForm'
import { StatusForm } from '../components/StatusForm'
import { StatusCard } from '../components/StatusCard'
import { SponsoredAdCard } from '../components/SponsoredAdCard'
import { SponsoredAdBanner } from '../components/SponsoredAdBanner'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'

const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000

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

  const {
    statuses,
    loading: loadingFeed,
    error: feedError,
    refresh: refreshFeed,
    addStatusLocally,
    remove,
    now,
  } = useCommunityFeed(id, member)

  // enabled=member: só busca depois de confirmar participação, nunca antes -- ver
  // comentário em useSponsoredAds.js sobre por que isso é obrigatório, não só uma
  // otimização.
  const { feedAds, bannerAds } = useSponsoredAds(id, member)

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
  const canPost = isSuperAdmin || community?.postAccess !== 'admins'

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
              {community.description && (
                <Text as="p" className="community-description">
                  {community.description}
                </Text>
              )}
            </Box>
            {member ? (
              <Button onClick={handleLeave} disabled={membershipPending} sx={{ flexShrink: 0 }}>
                Sair
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleJoin}
                disabled={membershipPending}
                sx={{ flexShrink: 0 }}
              >
                Entrar
              </Button>
            )}
          </Box>

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
                        <Button
                          leadingVisual={TrophyIcon}
                          onClick={() => setFormOpen('achievement')}
                        >
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
                <AchievementForm
                  onSubmit={handleCreateStatus}
                  onCancel={() => setFormOpen(false)}
                />
              )}
              {canPost && formOpen === 'status' && (
                <StatusForm
                  communityId={id}
                  author={{
                    id: user.uid,
                    username: profile?.username || null,
                    role: profile?.role,
                  }}
                  onSubmit={handleCreateStatus}
                  onCancel={() => setFormOpen(false)}
                />
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
                {feedAds.map((ad) => (
                  <SponsoredAdCard key={ad.id} ad={ad} />
                ))}
                {statuses.map((status) => (
                  <StatusCard
                    key={status.id}
                    status={status}
                    currentUserId={user.uid}
                    canDelete={status.authorId === user.uid || isSuperAdmin}
                    onDelete={handleDeleteStatus}
                    now={now}
                    showToast={showToast}
                  />
                ))}
              </div>
            </>
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

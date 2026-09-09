import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { Box, Heading, Text, Button, Spinner, Link } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { ChevronLeftIcon, MegaphoneIcon, PlusIcon, PeopleIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useCommunityFeed } from '../hooks/useCommunityFeed'
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
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'

const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000

export default function CommunityDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile, isSuperAdmin } = useAuth()
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()

  const [community, setCommunity] = useState(null)
  const [member, setMember] = useState(false)
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
  } = useCommunityFeed(id)

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

  async function handleJoin() {
    try {
      await joinCommunity(id, user.uid)
      setMember(true)
      refreshFeed()
      showToast('Você entrou na comunidade.')
    } catch (err) {
      console.error('[CommunityDetail] join:', err)
      showToast('Erro ao entrar na comunidade.', 'danger')
    }
  }

  async function handleLeave() {
    try {
      await leaveCommunity(id, user.uid)
      setMember(false)
      showToast('Você saiu da comunidade.')
    } catch (err) {
      console.error('[CommunityDetail] leave:', err)
      showToast('Erro ao sair da comunidade.', 'danger')
    }
  }

  async function handleCreateStatus(values) {
    const author = { id: user.uid, username: profile?.username || null }
    const expiresAt = new Date(Date.now() + STATUS_LIFETIME_MS)
    try {
      if (values.type === 'achievement') {
        const ref = await createAchievementStatus(id, author, values.achievement)
        addStatusLocally({
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
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
          type: 'workout',
          workout: {
            title: values.title.trim(),
            date: new Date(values.date),
            location: values.location.trim(),
          },
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

  return (
    <Box sx={{ maxWidth: '680px', mx: 'auto' }}>
      <ToastFlash toasts={toasts} />
      <Link
        as={RouterLink}
        to="/comunidades"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 3, fontSize: 1 }}
      >
        <ChevronLeftIcon /> Comunidades
      </Link>

      {loadingCommunity && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={communityError} onRetry={loadCommunity} />

      {!loadingCommunity && !communityError && community && (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 3,
              mb: 4,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Heading as="h1" sx={{ fontSize: 4, mb: community.description ? 1 : 0 }}>
                {community.name}
              </Heading>
              {community.description && (
                <Text sx={{ color: 'fg.muted', fontSize: 1, display: 'block' }}>
                  {community.description}
                </Text>
              )}
            </Box>
            {member ? (
              <Button onClick={handleLeave} sx={{ flexShrink: 0 }}>
                Sair
              </Button>
            ) : (
              <Button variant="primary" onClick={handleJoin} sx={{ flexShrink: 0 }}>
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
              <Blankslate.PrimaryAction onClick={handleJoin}>Entrar</Blankslate.PrimaryAction>
            </Blankslate>
          )}

          {member && (
            <>
              {!formOpen && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 4 }}>
                  <Button
                    leadingVisual={PlusIcon}
                    variant="primary"
                    onClick={() => setFormOpen('status')}
                  >
                    Publicar
                  </Button>
                  <Button onClick={() => setFormOpen('achievement')}>
                    Compartilhar conquista do dia
                  </Button>
                </Box>
              )}
              {formOpen === 'achievement' && (
                <AchievementForm
                  onSubmit={handleCreateStatus}
                  onCancel={() => setFormOpen(false)}
                />
              )}
              {formOpen === 'status' && (
                <StatusForm onSubmit={handleCreateStatus} onCancel={() => setFormOpen(false)} />
              )}

              {loadingFeed && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
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

              {!loadingFeed &&
                statuses.map((status) => (
                  <StatusCard
                    key={status.id}
                    status={status}
                    currentUserId={user.uid}
                    canDelete={status.authorId === user.uid || isSuperAdmin}
                    onDelete={handleDeleteStatus}
                    now={now}
                  />
                ))}
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
          <Blankslate.PrimaryAction onClick={() => navigate('/comunidades')}>
            Voltar
          </Blankslate.PrimaryAction>
        </Blankslate>
      )}
    </Box>
  )
}

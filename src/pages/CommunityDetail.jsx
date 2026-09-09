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
  createTextStatus,
  createPollStatus,
  createWorkoutStatus,
} from '../services/statusesService'
import { describeFirestoreError } from '../utils/firestoreError'
import { StatusForm } from '../components/StatusForm'
import { StatusCard } from '../components/StatusCard'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'

export default function CommunityDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, isSuperAdmin } = useAuth()
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
    const author = { id: user.uid, email: user.email }
    try {
      if (values.type === 'text') {
        const ref = await createTextStatus(id, author, values.text)
        addStatusLocally({
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorEmail: author.email,
          type: 'text',
          text: values.text.trim(),
          createdAt: new Date(),
        })
      } else if (values.type === 'poll') {
        const ref = await createPollStatus(id, author, values.question, values.options)
        addStatusLocally({
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorEmail: author.email,
          type: 'poll',
          poll: {
            question: values.question.trim(),
            options: values.options.map((label, index) => ({ id: String(index), label })),
          },
          createdAt: new Date(),
        })
      } else if (values.type === 'workout') {
        const ref = await createWorkoutStatus(id, author, values)
        addStatusLocally({
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorEmail: author.email,
          type: 'workout',
          workout: {
            title: values.title.trim(),
            date: new Date(values.date),
            location: values.location.trim(),
          },
          createdAt: new Date(),
        })
      }
      setFormOpen(false)
      showToast('Publicado na comunidade.')
    } catch (err) {
      console.error('[CommunityDetail] createStatus:', err)
      showToast('Erro ao publicar.', 'danger')
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
    <Box>
      <ToastFlash toasts={toasts} />
      <Link
        as={RouterLink}
        to="/comunidades"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 2, fontSize: 1 }}
      >
        <ChevronLeftIcon /> Comunidades
      </Link>

      {loadingCommunity && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={communityError} onRetry={loadCommunity} />

      {!loadingCommunity && !communityError && community && (
        <>
          <Box
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
          >
            <Heading as="h1" sx={{ fontSize: 3 }}>
              {community.name}
            </Heading>
            {member ? (
              <Button size="small" onClick={handleLeave}>
                Sair
              </Button>
            ) : (
              <Button size="small" variant="primary" onClick={handleJoin}>
                Entrar
              </Button>
            )}
          </Box>
          {community.description && (
            <Text sx={{ color: 'fg.muted', display: 'block', mb: 3 }}>{community.description}</Text>
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
              <Blankslate.PrimaryAction onClick={handleJoin}>Entrar</Blankslate.PrimaryAction>
            </Blankslate>
          )}

          {member && (
            <>
              {!formOpen && (
                <Button
                  leadingVisual={PlusIcon}
                  variant="primary"
                  onClick={() => setFormOpen(true)}
                  sx={{ mb: 3 }}
                >
                  Publicar
                </Button>
              )}
              {formOpen && (
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

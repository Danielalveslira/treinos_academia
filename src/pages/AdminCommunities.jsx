import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Heading, Text, Button, Spinner, Label } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PeopleIcon, PlusIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import { useAdminCommunities } from '../hooks/useAdminCommunities'
import { useToast } from '../hooks/useToast'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { CommunityForm } from '../components/CommunityForm'
import { CommunityIcon } from '../components/CommunityIcon'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { RowActionsMenu } from '../components/RowActionsMenu'

export default function AdminCommunities() {
  const {
    communities,
    memberCounts,
    hasMore,
    loadMore,
    loading,
    error,
    refresh,
    add,
    edit,
    toggleActive,
    remove,
  } = useAdminCommunities()
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()
  const [formOpen, setFormOpen] = useState(false)
  const [editingCommunity, setEditingCommunity] = useState(null)
  const actionLock = useRef(false)
  const [busyCommunityId, setBusyCommunityId] = useState(null)

  function beginRowAction(communityId) {
    if (actionLock.current) return false
    actionLock.current = true
    setBusyCommunityId(communityId)
    return true
  }

  function endRowAction() {
    actionLock.current = false
    setBusyCommunityId(null)
  }

  async function handleCreate(values) {
    try {
      await add(values)
      setFormOpen(false)
      showToast('Comunidade criada.')
    } catch (err) {
      console.error('[AdminCommunities] create:', err)
      showToast('Erro ao criar comunidade.', 'danger')
    }
  }

  async function handleUpdate(values) {
    try {
      await edit(editingCommunity.id, values)
      setEditingCommunity(null)
      showToast('Comunidade atualizada.')
    } catch (err) {
      console.error('[AdminCommunities] update:', err)
      showToast('Erro ao atualizar comunidade.', 'danger')
    }
  }

  async function handleToggleActive(community) {
    if (!beginRowAction(community.id)) return
    try {
      await toggleActive(community.id, !community.isActive)
      showToast(community.isActive ? 'Comunidade desativada.' : 'Comunidade ativada.')
    } catch (err) {
      console.error('[AdminCommunities] toggleActive:', err)
      showToast('Erro ao alterar status.', 'danger')
    } finally {
      endRowAction()
    }
  }

  async function handleDelete(community) {
    const confirmed = await confirmDelete({
      title: `Excluir "${community.name}"?`,
      content: 'A comunidade será bloqueada e seus dados serão excluídos em etapas.',
    })
    if (!confirmed) return
    if (!beginRowAction(community.id)) return
    try {
      await remove(community.id)
      showToast('Exclusão da comunidade agendada.')
    } catch (err) {
      console.error('[AdminCommunities] delete:', err)
      showToast('Erro ao excluir comunidade.', 'danger')
    } finally {
      endRowAction()
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Button as={Link} to="/admin/moderacao" replace>
          Atendimento e moderação
        </Button>
        <Button as={Link} to="/admin/contas" replace>
          Contas
        </Button>
        <Button as={Link} to="/admin/parcerias" replace>
          Anúncios e parcerias
        </Button>
      </Box>
      <ToastFlash toasts={toasts} />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Heading as="h1" sx={{ fontSize: 3 }}>
          Administrar comunidades
        </Heading>
        {!formOpen && !editingCommunity && (loading || error || communities.length > 0) && (
          <Button leadingVisual={PlusIcon} variant="primary" onClick={() => setFormOpen(true)}>
            Nova
          </Button>
        )}
      </Box>

      {formOpen && <CommunityForm onSubmit={handleCreate} onCancel={() => setFormOpen(false)} />}
      {editingCommunity && (
        <CommunityForm
          initialValue={editingCommunity}
          onSubmit={handleUpdate}
          onCancel={() => setEditingCommunity(null)}
        />
      )}

      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && communities.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <PeopleIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhuma comunidade criada</Blankslate.Heading>
          <Blankslate.PrimaryAction onClick={() => setFormOpen(true)}>
            Criar comunidade
          </Blankslate.PrimaryAction>
        </Blankslate>
      )}

      {communities.length > 0 && (
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {communities.map((community, index) => (
            <Box
              key={community.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 3,
                py: 2,
                borderTop: index === 0 ? 'none' : '1px solid',
                borderColor: 'border.default',
              }}
            >
              <CommunityIcon community={community} size={40} />

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Text sx={{ fontWeight: 'bold' }}>{community.name}</Text>
                  <Label variant={community.isActive ? 'success' : 'secondary'}>
                    {community.isActive ? 'Ativa' : 'Inativa'}
                  </Label>
                  {community.postAccess === 'admins' && (
                    <Label variant="attention">Publicação restrita</Label>
                  )}
                </Box>
                <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                  {memberCounts[community.id] ?? 0} membros
                </Text>
              </Box>

              <Button
                size="small"
                loading={busyCommunityId === community.id}
                disabled={community.deletionStatus === 'pending' || busyCommunityId !== null}
                onClick={() => handleToggleActive(community)}
              >
                {community.isActive ? 'Desativar' : 'Ativar'}
              </Button>
              <RowActionsMenu
                disabled={community.deletionStatus === 'pending' || busyCommunityId !== null}
                actions={[
                  {
                    key: 'edit',
                    label: 'Editar',
                    icon: PencilIcon,
                    onSelect: () => setEditingCommunity(community),
                  },
                  {
                    key: 'delete',
                    label: 'Excluir',
                    icon: TrashIcon,
                    variant: 'danger',
                    onSelect: () => handleDelete(community),
                  },
                ]}
              />
            </Box>
          ))}
        </Box>
      )}
      {hasMore && (
        <Button onClick={loadMore} disabled={loading} sx={{ mt: 3 }}>
          Carregar mais comunidades
        </Button>
      )}
    </Box>
  )
}

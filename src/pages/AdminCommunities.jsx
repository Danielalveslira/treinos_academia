import { useRef, useState } from 'react'
import { Box, Heading, Text, Button, Spinner, Label } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PeopleIcon, PlusIcon, ImageIcon } from '@primer/octicons-react'
import { useAdminCommunities } from '../hooks/useAdminCommunities'
import { useToast } from '../hooks/useToast'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { updateCommunityImage } from '../services/communitiesService'
import { uploadCommunityCoverImage } from '../utils/imageUpload'
import { CommunityForm } from '../components/CommunityForm'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { RowActionsMenu } from '../components/RowActionsMenu'

export default function AdminCommunities() {
  const { communities, memberCounts, loading, error, refresh, add, edit, toggleActive, remove } =
    useAdminCommunities()
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()
  const [formOpen, setFormOpen] = useState(false)
  const [editingCommunity, setEditingCommunity] = useState(null)
  const [uploadingId, setUploadingId] = useState(null)
  const fileInputRef = useRef(null)
  const uploadTargetId = useRef(null)

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
    try {
      await toggleActive(community.id, !community.isActive)
      showToast(community.isActive ? 'Comunidade desativada.' : 'Comunidade ativada.')
    } catch (err) {
      console.error('[AdminCommunities] toggleActive:', err)
      showToast('Erro ao alterar status.', 'danger')
    }
  }

  async function handleDelete(community) {
    const confirmed = await confirmDelete({
      title: `Excluir "${community.name}"?`,
      content: 'As publicações e filiações desta comunidade não serão excluídas automaticamente.',
    })
    if (!confirmed) return
    try {
      await remove(community.id)
      showToast('Comunidade excluída.')
    } catch (err) {
      console.error('[AdminCommunities] delete:', err)
      showToast('Erro ao excluir comunidade.', 'danger')
    }
  }

  function triggerImageUpload(communityId) {
    uploadTargetId.current = communityId
    fileInputRef.current?.click()
  }

  async function handleImageSelected(e) {
    const file = e.target.files?.[0]
    const communityId = uploadTargetId.current
    e.target.value = ''
    if (!file || !communityId) return

    setUploadingId(communityId)
    try {
      const imageUrl = await uploadCommunityCoverImage(communityId, file)
      await updateCommunityImage(communityId, imageUrl)
      await refresh()
      showToast('Imagem atualizada.')
    } catch (err) {
      console.error('[AdminCommunities] upload image:', err)
      showToast('Erro ao enviar imagem.', 'danger')
    } finally {
      setUploadingId(null)
    }
  }

  return (
    <Box>
      <ToastFlash toasts={toasts} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleImageSelected}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Heading as="h1" sx={{ fontSize: 3 }}>
          Administrar comunidades
        </Heading>
        {!formOpen && !editingCommunity && (
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

      {!loading && !error && communities.length > 0 && (
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
              <Box
                as="button"
                type="button"
                onClick={() => triggerImageUpload(community.id)}
                disabled={uploadingId === community.id}
                aria-label={`Alterar imagem de ${community.name}`}
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 2,
                  bg: 'canvas.subtle',
                  border: '1px solid',
                  borderColor: 'border.default',
                  flexShrink: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  p: 0,
                }}
              >
                {uploadingId === community.id ? (
                  <Spinner size="small" />
                ) : community.imageUrl ? (
                  <Box
                    as="img"
                    src={community.imageUrl}
                    alt=""
                    sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <ImageIcon size={16} />
                )}
              </Box>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Text sx={{ fontWeight: 'bold' }}>{community.name}</Text>
                  <Label variant={community.isActive ? 'success' : 'secondary'}>
                    {community.isActive ? 'Ativa' : 'Inativa'}
                  </Label>
                </Box>
                <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                  {memberCounts[community.id] ?? 0} membros
                </Text>
              </Box>

              <Button size="small" onClick={() => handleToggleActive(community)}>
                {community.isActive ? 'Desativar' : 'Ativar'}
              </Button>
              <RowActionsMenu
                onEdit={() => setEditingCommunity(community)}
                onDelete={() => handleDelete(community)}
              />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

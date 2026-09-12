import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Heading, Text, Button, Spinner, Label } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { MegaphoneIcon, PlusIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import { useAdminSponsoredAds } from '../hooks/useAdminSponsoredAds'
import { useAdminCommunities } from '../hooks/useAdminCommunities'
import { useToast } from '../hooks/useToast'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { SponsoredAdForm } from '../components/SponsoredAdForm'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { RowActionsMenu } from '../components/RowActionsMenu'
import { toMillis } from '../utils/expiry'
import { SponsoredAdCapError } from '../utils/validators'

function isExpired(ad, now) {
  return Boolean(ad.expiresAt) && toMillis(ad.expiresAt) < now
}

export default function AdminSponsoredAds() {
  const { ads, loading, error, refresh, add, edit, remove } = useAdminSponsoredAds()
  const { communities } = useAdminCommunities()
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()
  const [formOpen, setFormOpen] = useState(false)
  const [editingAd, setEditingAd] = useState(null)

  // Deriva a contagem por comunidade da mesma lista já carregada pra exibir a lista de
  // anúncios abaixo -- evita uma leitura por comunidade (N+1) só pra mostrar o badge
  // "X/6 anúncios" no seletor do formulário. Exclui o próprio anúncio em edição do
  // total, senão editar um anúncio que já ocupa uma vaga mostraria erroneamente "no
  // limite" para comunidades que ele mesmo já integra.
  const adCountByCommunityId = useMemo(() => {
    const counts = {}
    for (const ad of ads) {
      if (ad.id === editingAd?.id) continue
      for (const communityId of ad.communityIds) {
        counts[communityId] = (counts[communityId] || 0) + 1
      }
    }
    return counts
  }, [ads, editingAd])

  // SponsoredAdCapError é relançado de propósito, sem toast: SponsoredAdForm já captura
  // esse erro específico e marca o campo de comunidades em vez de mostrar um toast
  // genérico (ver a resposta do teto de anúncios ativos). Qualquer outro erro é tratado
  // aqui mesmo, igual ao restante do painel admin.
  async function handleCreate(values) {
    try {
      await add(values)
      setFormOpen(false)
      showToast('Anúncio criado.')
    } catch (err) {
      if (err instanceof SponsoredAdCapError) throw err
      console.error('[AdminSponsoredAds] create:', err)
      showToast('Erro ao criar anúncio.', 'danger')
    }
  }

  async function handleUpdate(values) {
    try {
      await edit(editingAd.id, values)
      setEditingAd(null)
      showToast('Anúncio atualizado.')
    } catch (err) {
      if (err instanceof SponsoredAdCapError) throw err
      console.error('[AdminSponsoredAds] update:', err)
      showToast('Erro ao atualizar anúncio.', 'danger')
    }
  }

  async function handleDelete(ad) {
    const confirmed = await confirmDelete({
      title: `Excluir "${ad.title}"?`,
      content: 'O anúncio deixa de aparecer imediatamente em todas as comunidades listadas.',
    })
    if (!confirmed) return
    try {
      await remove(ad.id)
      showToast('Anúncio excluído.')
    } catch (err) {
      console.error('[AdminSponsoredAds] delete:', err)
      showToast('Erro ao excluir anúncio.', 'danger')
    }
  }

  const now = Date.now()

  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Button as={Link} to="/admin/comunidades" replace>
          Comunidades
        </Button>
        <Button as={Link} to="/admin/contas" replace>
          Contas
        </Button>
        <Button as={Link} to="/admin/moderacao" replace>
          Atendimento e moderação
        </Button>
      </Box>
      <ToastFlash toasts={toasts} />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Heading as="h1" sx={{ fontSize: 3 }}>
          Anúncios e parcerias
        </Heading>
        {!formOpen && !editingAd && (
          <Button leadingVisual={PlusIcon} variant="primary" onClick={() => setFormOpen(true)}>
            Novo
          </Button>
        )}
      </Box>

      {formOpen && (
        <SponsoredAdForm
          communities={communities}
          adCountByCommunityId={adCountByCommunityId}
          onSubmit={handleCreate}
          onCancel={() => setFormOpen(false)}
        />
      )}
      {editingAd && (
        <SponsoredAdForm
          initialValue={editingAd}
          communities={communities}
          adCountByCommunityId={adCountByCommunityId}
          onSubmit={handleUpdate}
          onCancel={() => setEditingAd(null)}
        />
      )}

      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && ads.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <MegaphoneIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhum anúncio criado</Blankslate.Heading>
          <Blankslate.PrimaryAction onClick={() => setFormOpen(true)}>
            Criar anúncio
          </Blankslate.PrimaryAction>
        </Blankslate>
      )}

      {ads.length > 0 && (
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {ads.map((ad, index) => (
            <Box
              key={ad.id}
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
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Text sx={{ fontWeight: 'bold' }}>{ad.title}</Text>
                  {isExpired(ad, now) && <Label variant="danger">Expirado</Label>}
                </Box>
                <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                  {ad.partnerName} · {ad.communityIds.length}{' '}
                  {ad.communityIds.length === 1 ? 'comunidade' : 'comunidades'}
                </Text>
              </Box>
              <RowActionsMenu
                actions={[
                  {
                    key: 'edit',
                    label: 'Editar',
                    icon: PencilIcon,
                    onSelect: () => setEditingAd(ad),
                  },
                  {
                    key: 'delete',
                    label: 'Excluir',
                    icon: TrashIcon,
                    variant: 'danger',
                    onSelect: () => handleDelete(ad),
                  },
                ]}
              />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

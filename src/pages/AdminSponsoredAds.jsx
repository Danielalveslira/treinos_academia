import { Suspense, lazy, useMemo, useRef, useState } from 'react'
import { Box, Heading, Text, Button, Spinner, Label, UnderlineNav } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { MegaphoneIcon, PlusIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import { useAdminSponsoredAds } from '../hooks/useAdminSponsoredAds'
import { useAdminCommunities } from '../hooks/useAdminCommunities'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { SponsoredAdForm } from '../components/SponsoredAdForm'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { RowActionsMenu } from '../components/RowActionsMenu'
import AdminNav from '../components/AdminNav'
import { toMillis } from '../utils/expiry'
import { SponsoredAdCapError, SponsoredAdGlobalCapError } from '../utils/validators'

// Aba Métricas: módulo (e o gráfico) só são baixados quando o superadmin abre a aba; nada de leitura antes disso.
const AdMetricsTab = lazy(() => import('../features/adMetrics/components/AdMetricsTab'))
const CommercialAdmin = lazy(() => import('../components/CommercialAdmin'))

const TABS = [
  { key: 'campaigns', label: 'Campanhas' },
  { key: 'metrics', label: 'Métricas' },
  { key: 'commercial', label: 'Propostas e produtos' },
]

function isExpired(ad, now) {
  return Boolean(ad.expiresAt) && toMillis(ad.expiresAt) < now
}

export default function AdminSponsoredAds() {
  const { ads, loading, error, refresh, add, edit, remove } = useAdminSponsoredAds()
  const { communities } = useAdminCommunities()
  const { user } = useAuth()
  const [tab, setTab] = useState('campaigns')
  const [metricsOpened, setMetricsOpened] = useState(false)
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()
  const [formOpen, setFormOpen] = useState(false)
  const [editingAd, setEditingAd] = useState(null)
  const actionLock = useRef(false)
  const [busyAdId, setBusyAdId] = useState(null)

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

  // Mesmo raciocínio de adCountByCommunityId, mas para o teto global (isGlobal) — uma
  // única contagem, não um mapa por comunidade.
  const globalAdCount = useMemo(
    () => ads.filter((ad) => ad.isGlobal && ad.id !== editingAd?.id).length,
    [ads, editingAd]
  )

  // SponsoredAdCapError/SponsoredAdGlobalCapError são relançados de propósito, sem toast:
  // SponsoredAdForm já captura esses erros específicos e marca o campo correspondente em
  // vez de mostrar um toast genérico (ver a resposta dos tetos de anúncios ativos).
  // Qualquer outro erro é tratado aqui mesmo, igual ao restante do painel admin.
  async function handleCreate(values) {
    try {
      await add(values)
      setFormOpen(false)
      showToast('Anúncio criado.')
    } catch (err) {
      if (err instanceof SponsoredAdCapError || err instanceof SponsoredAdGlobalCapError) throw err
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
      if (err instanceof SponsoredAdCapError || err instanceof SponsoredAdGlobalCapError) throw err
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
    if (actionLock.current) return
    actionLock.current = true
    setBusyAdId(ad.id)
    try {
      await remove(ad.id)
      showToast('Anúncio excluído.')
    } catch (err) {
      console.error('[AdminSponsoredAds] delete:', err)
      showToast('Erro ao excluir anúncio.', 'danger')
    } finally {
      actionLock.current = false
      setBusyAdId(null)
    }
  }

  const now = Date.now()

  return (
    <Box>
      <AdminNav current="/admin/parcerias" currentLabel="Anúncios e parcerias" />
      <ToastFlash toasts={toasts} />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Heading as="h1" sx={{ fontSize: 3 }}>
          Anúncios e parcerias
        </Heading>
        {tab === 'campaigns' && !formOpen && !editingAd && (loading || error || ads.length > 0) && (
          <Button leadingVisual={PlusIcon} variant="primary" onClick={() => setFormOpen(true)}>
            Novo
          </Button>
        )}
      </Box>

      <UnderlineNav aria-label="Seções de anúncios e parcerias" sx={{ mb: 3 }}>
        {TABS.map((item) => (
          <UnderlineNav.Item
            key={item.key}
            as="button"
            aria-current={tab === item.key ? 'page' : undefined}
            onSelect={() => {
              setTab(item.key)
              if (item.key === 'metrics') setMetricsOpened(true)
            }}
          >
            {item.label}
          </UnderlineNav.Item>
        ))}
      </UnderlineNav>

      {metricsOpened && (
        <Box hidden={tab !== 'metrics'}>
          <Suspense fallback={<Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}>
            <AdMetricsTab userId={user?.uid} ads={ads} communities={communities} />
          </Suspense>
        </Box>
      )}

      {tab === 'commercial' && <Suspense fallback={<Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}><CommercialAdmin /></Suspense>}

      <Box hidden={tab !== 'campaigns'}>
        {formOpen && (
          <SponsoredAdForm
            communities={communities}
            adCountByCommunityId={adCountByCommunityId}
            globalAdCount={globalAdCount}
            onSubmit={handleCreate}
            onCancel={() => setFormOpen(false)}
          />
        )}
        {editingAd && (
          <SponsoredAdForm
            initialValue={editingAd}
            communities={communities}
            adCountByCommunityId={adCountByCommunityId}
            globalAdCount={globalAdCount}
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
                    {ad.isGlobal && <Label variant="accent">Home</Label>}
                    {isExpired(ad, now) && <Label variant="danger">Expirado</Label>}
                  </Box>
                  <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                    {ad.partnerName}
                    {ad.communityIds.length > 0 &&
                      ` · ${ad.communityIds.length} ${ad.communityIds.length === 1 ? 'comunidade' : 'comunidades'}`}
                  </Text>
                </Box>
                <RowActionsMenu
                  disabled={busyAdId !== null}
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
    </Box>
  )
}

import { Link, useSearchParams } from 'react-router-dom'
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
const AdvertiserAdmin = lazy(() => import('../features/adMetrics/components/AdvertiserAdmin'))
const AdvertisingAdmin = lazy(() => import('../components/AdvertisingAdmin'))
const CommercialAdmin = lazy(() => import('../components/CommercialAdmin'))
const CommercialEngineAdmin = lazy(() => import('../components/CommercialEngineAdmin'))
const CommercialOverview = lazy(() => import('../components/CommercialOverview'))
const ApprovalsQueue = lazy(() => import('../components/ApprovalsQueue'))

const TABS = [
  { key: 'campaigns', label: 'Campanhas' },
  { key: 'advertisers', label: 'Anunciantes' },
  { key: 'metrics', label: 'Resultados' },
]

const SECTIONS = [
  { key: 'overview', label: 'Visão geral' },
  { key: 'approvals', label: 'Aprovações' },
  { key: 'advertising', label: 'Publicidade' },
  { key: 'storefronts', label: 'Vitrines e parceiros' },
  { key: 'finance', label: 'Financeiro' },
  { key: 'settings', label: 'Configurações' },
]
const LEGACY_SECTIONS = {
  campaigns: 'advertising',
  metrics: 'advertising',
  advertisers: 'advertising',
  autonomous: 'settings',
  commercial: 'storefronts',
  engine: 'finance',
}

function TaskLinks({ items }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', 'repeat(2,minmax(0,1fr))'], gap: 2 }}>
      {items.map(({ to, title, description }) => (
        <Box
          key={title}
          sx={{
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            p: 3,
            minWidth: 0,
          }}
        >
          <Heading as="h2" sx={{ fontSize: 2, mb: 1 }}>
            {title}
          </Heading>
          <Text as="p" sx={{ color: 'fg.muted', fontSize: 1, mt: 0 }}>
            {description}
          </Text>
          <Button as={Link} to={to}>
            Abrir
          </Button>
        </Box>
      ))}
    </Box>
  )
}

function isExpired(ad, now) {
  return Boolean(ad.expiresAt) && toMillis(ad.expiresAt) < now
}

export default function AdminSponsoredAds() {
  const [params, setParams] = useSearchParams()
  const reportRequested = params.get('report') === 'metrics'
  const requestedTab = params.get('tab')
  const section = SECTIONS.some((item) => item.key === params.get('section'))
    ? params.get('section')
    : LEGACY_SECTIONS[requestedTab] || (reportRequested ? 'advertising' : 'overview')
  const tab = TABS.some((item) => item.key === requestedTab)
    ? requestedTab
    : reportRequested
      ? 'metrics'
      : 'campaigns'
  const needsCampaigns = section === 'advertising' && (tab === 'campaigns' || tab === 'metrics')
  const { ads, loading, error, refresh, add, edit, remove } = useAdminSponsoredAds(needsCampaigns)
  const { communities } = useAdminCommunities(needsCampaigns)
  const { user } = useAuth()
  const [metricsOpened, setMetricsOpened] = useState(reportRequested || requestedTab === 'metrics')
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
      <AdminNav current="/admin/parcerias" currentLabel="Central comercial" />
      <ToastFlash toasts={toasts} />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Heading as="h1" sx={{ fontSize: 3 }}>
          Central comercial
        </Heading>
        {section === 'advertising' &&
          tab === 'campaigns' &&
          !formOpen &&
          !editingAd &&
          (loading || error || ads.length > 0) && (
            <Button leadingVisual={PlusIcon} variant="primary" onClick={() => setFormOpen(true)}>
              Novo
            </Button>
          )}
      </Box>

      <Box
        role="navigation"
        aria-label="Seções da central comercial"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}
      >
        {SECTIONS.map((item) => (
          <Button
            key={item.key}
            aria-current={section === item.key ? 'page' : undefined}
            variant={section === item.key ? 'primary' : 'default'}
            onClick={() => setParams({ section: item.key })}
          >
            {item.label}
          </Button>
        ))}
      </Box>

      {section === 'overview' && (
        <Suspense fallback={<Spinner aria-label="Carregando visão geral" />}>
          <CommercialOverview />
        </Suspense>
      )}

      {section === 'approvals' && (
        <>
          <Suspense fallback={<Spinner aria-label="Carregando aprovações" />}>
            <ApprovalsQueue />
          </Suspense>
          <Heading as="h2" sx={{ fontSize: 2, mt: 4 }}>
            Outras moderações
          </Heading>
          <TaskLinks
            items={[
              {
                to: '/admin/vitrines',
                title: 'Profissionais e estabelecimentos',
                description: 'Analisar cadastros e publicação (fila própria).',
              },
            ]}
          />
        </>
      )}

      {section === 'advertising' && (
        <UnderlineNav aria-label="Publicidade" sx={{ mb: 3, maxWidth: '100%', overflowX: 'auto' }}>
          {TABS.map((item) => (
            <UnderlineNav.Item
              key={item.key}
              as="button"
              aria-current={tab === item.key ? 'page' : undefined}
              onSelect={() => {
                setParams({ section: 'advertising', tab: item.key })
                if (item.key === 'metrics') setMetricsOpened(true)
              }}
            >
              {item.label}
            </UnderlineNav.Item>
          ))}
        </UnderlineNav>
      )}

      {section === 'storefronts' && (
        <>
          <TaskLinks
            items={[
              {
                to: '/admin/vitrines',
                title: 'Profissionais e estabelecimentos',
                description: 'Cadastros, moderação e publicação.',
              },
              {
                to: '/admin/parcerias?tab=commercial',
                title: 'Propostas e produtos legados',
                description: 'Registros anteriores e contatos comerciais.',
              },
            ]}
          />
          {requestedTab === 'commercial' && (
            <Suspense fallback={<Spinner />}>
              <CommercialAdmin />
            </Suspense>
          )}
        </>
      )}

      {section === 'finance' && (
        <>
          <TaskLinks
            items={[
              {
                to: '/admin/compras-evocash',
                title: 'Compras de EvoCash',
                description: 'Pagamentos em reais e reconciliação.',
              },
              {
                to: '/admin/compras-evocash?tab=pricing',
                title: 'Preço do EvoCash',
                description: 'Valor de aquisição em reais.',
              },
              {
                to: '/admin/compras-evocash?tab=refunds',
                title: 'Reembolsos',
                description: 'Solicitações e comprovações.',
              },
              {
                to: '/admin/parcerias?tab=engine',
                title: 'Preços e contratações',
                description: 'Serviços cobrados em EvoCash.',
              },
            ]}
          />
          {requestedTab === 'engine' && (
            <Suspense fallback={<Spinner />}>
              <CommercialEngineAdmin />
            </Suspense>
          )}
        </>
      )}

      {section === 'settings' && (
        <Suspense fallback={<Spinner />}>
          <AdvertisingAdmin />
        </Suspense>
      )}

      {metricsOpened && (
        <Box hidden={section !== 'advertising' || tab !== 'metrics'}>
          <Suspense fallback={<Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}>
            <AdMetricsTab
              userId={user?.uid}
              ads={ads}
              communities={communities}
              initialFilters={
                reportRequested
                  ? {
                      days: Number(params.get('days')) || 30,
                      ...Object.fromEntries(
                        ['from', 'to', 'adId', 'communityId', 'placement'].map((k) => [
                          k,
                          params.get(k) || null,
                        ])
                      ),
                    }
                  : undefined
              }
            />
          </Suspense>
        </Box>
      )}

      {section === 'advertising' && tab === 'advertisers' && (
        <Suspense fallback={<Spinner />}>
          <AdvertiserAdmin />
        </Suspense>
      )}

      {section === 'advertising' && tab === 'campaigns' && (
        <Box>
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
      )}
    </Box>
  )
}

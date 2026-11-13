import { Link, useSearchParams } from 'react-router-dom'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Box, Heading, Text, Button, Spinner, Label, UnderlineNav } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { MegaphoneIcon, PlusIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import { useAdminSponsoredAds } from '../hooks/useAdminSponsoredAds'
import { useAdminCommunities } from '../hooks/useAdminCommunities'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { InstitutionalAdForm } from '../components/InstitutionalAdForm'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { RowActionsMenu } from '../components/RowActionsMenu'
import AdminNav from '../components/AdminNav'

// Aba Métricas: módulo (e o gráfico) só são baixados quando o superadmin abre a aba; nada de leitura antes disso.
const AdMetricsTab = lazy(() => import('../features/adMetrics/components/AdMetricsTab'))
const AdvertiserAdmin = lazy(() => import('../features/adMetrics/components/AdvertiserAdmin'))
const AdvertisingAdmin = lazy(() => import('../components/AdvertisingAdmin'))
const CommercialAdmin = lazy(() => import('../components/CommercialAdmin'))
const CommercialEngineAdmin = lazy(() => import('../components/CommercialEngineAdmin'))
const CommercialOverview = lazy(() => import('../components/CommercialOverview'))
const ApprovalsQueue = lazy(() => import('../components/ApprovalsQueue'))
const SupplierInfoGateAdmin = lazy(() => import('../components/SupplierInfoGateAdmin'))

// Quatro áreas (não seis): o restante da reestruturação está documentado em
// docs/prompts/PROMPT_REESTRUTURACAO_CENTRAL_COMERCIAL_EVOLUTUS.md (PR1). Cada área
// abre seu conteúdo direto -- nenhuma delas é só uma tela de cartões "Abrir".
const AREAS = [
  { key: 'inicio', label: 'Início' },
  { key: 'aprovacoes', label: 'Aprovações' },
  { key: 'publicidade', label: 'Publicidade' },
  { key: 'financeiro', label: 'Financeiro' },
]
// `?section=` antigo -> área nova. "settings" misturava canais de publicidade
// (AdvertisingAdmin) e o gate financeiro do fornecedor (SupplierInfoGateAdmin) sem
// nenhuma distinção própria; não há correspondência única, então o alias cai em
// Publicidade > Canais, que era a parte maior daquela tela.
const LEGACY_SECTION_TO_AREA = {
  overview: 'inicio',
  approvals: 'aprovacoes',
  advertising: 'publicidade',
  storefronts: 'publicidade',
  finance: 'financeiro',
  settings: 'publicidade',
}
// Aba padrão quando o link antigo só tinha `?section=`, sem `?tab=` (a seção em si
// já indicava o assunto -- sem isto, cairia sempre em "campanhas", perdendo o
// destino que `storefronts`/`settings` realmente pediam).
const LEGACY_SECTION_DEFAULT_TAB = {
  advertising: 'campanhas',
  storefronts: 'vitrines',
  settings: 'canais',
  finance: 'motor',
}
// Favoritos antigos que só guardavam `?tab=`, sem `?section=` (ver LEGACY_SECTIONS
// da versão anterior) -> área nova.
const LEGACY_BARE_TAB_TO_AREA = {
  campaigns: 'publicidade',
  metrics: 'publicidade',
  advertisers: 'publicidade',
  autonomous: 'publicidade',
  commercial: 'publicidade',
  engine: 'financeiro',
}

const PUBLICIDADE_TABS = [
  { key: 'campanhas', label: 'Campanhas' },
  { key: 'anunciantes', label: 'Anunciantes' },
  { key: 'metricas', label: 'Resultados' },
  { key: 'canais', label: 'Canais' },
  { key: 'vitrines', label: 'Vitrines e parceiros' },
]
const LEGACY_PUBLICIDADE_TAB = {
  campaigns: 'campanhas',
  advertisers: 'anunciantes',
  metrics: 'metricas',
  commercial: 'vitrines',
  autonomous: 'canais',
}

// O rótulo da aba não repete o título "Preços e contratações" que CommercialEngineAdmin
// já renderiza como <h2> -- evita o "Central comercial → Financeiro → Preços e
// contratações → Preços e contratações" que o prompt pediu para eliminar.
const FINANCEIRO_TABS = [
  { key: 'motor', label: 'Motor comercial' },
  { key: 'avancado', label: 'Avançado' },
]
const LEGACY_FINANCEIRO_TAB = { engine: 'motor' }

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

const DELIVERY_STATUS = {
  delivering: { label: 'Em exibição', variant: 'success' },
  partial: { label: 'Exibição parcial', variant: 'attention' },
  paused: { label: 'Exibição pausada', variant: 'attention' },
  suspended: { label: 'Suspenso', variant: 'secondary' },
  expired: { label: 'Expirado', variant: 'danger' },
}

function expiryLabel(value) {
  const date = new Date(value)
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0) {
    date.setUTCDate(date.getUTCDate() - 1)
  }
  return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

function placeLabel(place, communities) {
  if (place.code === 'home_banner') return 'Home'
  if (place.code === 'progress_banner') return 'Progresso'
  const community =
    communities.find((item) => item.id === place.contextId)?.name || 'comunidade selecionada'
  return `${place.code === 'community_banner' ? 'Banner' : 'Feed'} · ${community}`
}

export default function AdminSponsoredAds() {
  const [params, setParams] = useSearchParams()
  const reportRequested = params.get('report') === 'metrics'
  const requestedTab = params.get('tab')
  const requestedSection = params.get('section')
  const area = AREAS.some((item) => item.key === params.get('area'))
    ? params.get('area')
    : LEGACY_SECTION_TO_AREA[requestedSection] ||
      LEGACY_BARE_TAB_TO_AREA[requestedTab] ||
      (reportRequested ? 'publicidade' : 'inicio')
  // Prioridade ao resolver a aba legada: parâmetro canônico > alias de `tab` > pedido
  // explícito de relatório > aba padrão da `section` antiga > padrão genérico da área.
  const tab =
    area === 'publicidade'
      ? PUBLICIDADE_TABS.some((item) => item.key === requestedTab)
        ? requestedTab
        : LEGACY_PUBLICIDADE_TAB[requestedTab] ||
          (reportRequested ? 'metricas' : null) ||
          LEGACY_SECTION_DEFAULT_TAB[requestedSection] ||
          'campanhas'
      : area === 'financeiro'
        ? FINANCEIRO_TABS.some((item) => item.key === requestedTab)
          ? requestedTab
          : LEGACY_FINANCEIRO_TAB[requestedTab] ||
            LEGACY_SECTION_DEFAULT_TAB[requestedSection] ||
            'motor'
        : null
  const needsCampaigns = area === 'publicidade' && (tab === 'campanhas' || tab === 'metricas')
  const { ads, loading, error, refresh, add, edit, remove, setActive } =
    useAdminSponsoredAds(needsCampaigns)
  const {
    communities,
    hasMore: hasMoreCommunities,
    loadMore: loadMoreCommunities,
  } = useAdminCommunities(needsCampaigns)
  const { user } = useAuth()
  const [metricsOpened, setMetricsOpened] = useState(reportRequested || tab === 'metricas')
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()
  const [formOpen, setFormOpen] = useState(false)
  const [editingAd, setEditingAd] = useState(null)
  const actionLock = useRef(false)
  const [busyAdId, setBusyAdId] = useState(null)

  // Trocar de área deve posicionar o conteúdo novo logo abaixo do header fixo, nunca
  // deixar o scroll residual de uma lista longa da área anterior.
  useEffect(() => {
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0)
  }, [area])

  async function handleCreate(values, requestId) {
    await add(values, requestId)
    setFormOpen(false)
    showToast('Anúncio salvo. Ative-o quando o posicionamento estiver pronto.')
  }

  async function handleUpdate(values) {
    await edit(editingAd, values)
    setEditingAd(null)
    showToast('Anúncio atualizado.')
  }

  async function handleDelete(ad) {
    const confirmed = await confirmDelete({
      title: `Excluir "${ad.title}"?`,
      content: 'A exclusão só é permitida para anúncios suspensos e sem histórico de métricas.',
    })
    if (!confirmed) return
    if (actionLock.current) return
    actionLock.current = true
    setBusyAdId(ad.id)
    try {
      await remove(ad)
      showToast('Anúncio excluído.')
    } catch (err) {
      console.error('[AdminSponsoredAds] delete:', err)
      showToast(err.message || 'Erro ao excluir anúncio.', 'danger')
    } finally {
      actionLock.current = false
      setBusyAdId(null)
    }
  }

  async function handleActive(ad, active) {
    if (actionLock.current) return
    actionLock.current = true
    setBusyAdId(ad.id)
    try {
      await setActive(ad, active)
      showToast(active ? 'Anúncio ativado.' : 'Anúncio suspenso.')
    } catch (err) {
      showToast(err.message || 'Não foi possível alterar a publicação.', 'danger')
    } finally {
      actionLock.current = false
      setBusyAdId(null)
    }
  }

  return (
    <Box>
      <AdminNav current="/admin/parcerias" currentLabel="Central comercial" />
      <ToastFlash toasts={toasts} />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Heading as="h1" sx={{ fontSize: 3 }}>
          Central comercial
        </Heading>
        {area === 'publicidade' &&
          tab === 'campanhas' &&
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
        aria-label="Áreas da central comercial"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}
      >
        {AREAS.map((item) => (
          <Button
            key={item.key}
            aria-current={area === item.key ? 'page' : undefined}
            variant={area === item.key ? 'primary' : 'default'}
            onClick={() => setParams({ area: item.key })}
          >
            {item.label}
          </Button>
        ))}
      </Box>

      {area === 'inicio' && (
        <Suspense fallback={<Spinner aria-label="Carregando início" />}>
          <CommercialOverview />
        </Suspense>
      )}

      {area === 'aprovacoes' && (
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

      {area === 'publicidade' && (
        <UnderlineNav aria-label="Publicidade" sx={{ mb: 3, maxWidth: '100%', overflowX: 'auto' }}>
          {PUBLICIDADE_TABS.map((item) => (
            <UnderlineNav.Item
              key={item.key}
              as="button"
              aria-current={tab === item.key ? 'page' : undefined}
              onSelect={() => {
                setParams({ area: 'publicidade', tab: item.key })
                if (item.key === 'metricas') setMetricsOpened(true)
              }}
            >
              {item.label}
            </UnderlineNav.Item>
          ))}
        </UnderlineNav>
      )}

      {area === 'publicidade' && tab === 'canais' && (
        <Suspense fallback={<Spinner />}>
          <AdvertisingAdmin />
        </Suspense>
      )}

      {area === 'publicidade' && tab === 'vitrines' && (
        <Suspense fallback={<Spinner />}>
          <CommercialAdmin />
        </Suspense>
      )}

      {area === 'financeiro' && (
        <>
          <UnderlineNav aria-label="Financeiro" sx={{ mb: 3, maxWidth: '100%', overflowX: 'auto' }}>
            {FINANCEIRO_TABS.map((item) => (
              <UnderlineNav.Item
                key={item.key}
                as="button"
                aria-current={tab === item.key ? 'page' : undefined}
                onSelect={() => setParams({ area: 'financeiro', tab: item.key })}
              >
                {item.label}
              </UnderlineNav.Item>
            ))}
          </UnderlineNav>
          {tab === 'motor' && (
            <Suspense fallback={<Spinner />}>
              <CommercialEngineAdmin />
            </Suspense>
          )}
          {tab === 'avancado' && (
            <Suspense fallback={<Spinner />}>
              <SupplierInfoGateAdmin />
            </Suspense>
          )}
          <Heading as="h2" sx={{ fontSize: 2, mt: 4 }}>
            Compras e histórico de EvoCash
          </Heading>
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
                to: '/admin/compras-evocash?tab=prices',
                title: 'Histórico de preços do EvoCash',
                description: 'Versões publicadas, autor e justificativa.',
              },
            ]}
          />
        </>
      )}

      {metricsOpened && (
        <Box hidden={area !== 'publicidade' || tab !== 'metricas'}>
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

      {area === 'publicidade' && tab === 'anunciantes' && (
        <Suspense fallback={<Spinner />}>
          <AdvertiserAdmin />
        </Suspense>
      )}

      {area === 'publicidade' && tab === 'campanhas' && (
        <Box>
          <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mb: 3 }}>
            A situação indica disponibilidade para entrega; impressões registradas aparecem em
            Resultados.
          </Text>
          {formOpen && (
            <InstitutionalAdForm
              communities={communities}
              hasMoreCommunities={hasMoreCommunities}
              loadMoreCommunities={loadMoreCommunities}
              onSubmit={handleCreate}
              onCancel={() => setFormOpen(false)}
            />
          )}
          {editingAd && (
            <InstitutionalAdForm
              initialValue={editingAd}
              communities={communities}
              hasMoreCommunities={hasMoreCommunities}
              loadMoreCommunities={loadMoreCommunities}
              onSubmit={handleUpdate}
              onCancel={() => setEditingAd(null)}
            />
          )}

          {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
          <ErrorState error={error} onRetry={refresh} />

          {!loading && !error && ads.length === 0 && !formOpen && !editingAd && (
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
                      <Label variant={ad.commercial ? 'attention' : 'accent'}>
                        {ad.commercial ? 'Comercial' : 'Institucional'}
                      </Label>
                      {!ad.commercial && (
                        <Label variant={DELIVERY_STATUS[ad.deliveryStatus]?.variant || 'secondary'}>
                          {DELIVERY_STATUS[ad.deliveryStatus]?.label || 'Situação indisponível'}
                        </Label>
                      )}
                    </Box>
                    <Text sx={{ fontSize: 0, color: 'fg.muted', overflowWrap: 'anywhere' }}>
                      {ad.partnerName}
                      {!ad.commercial &&
                        (ad.placements || [])
                          .map((place) => placeLabel(place, communities))
                          .join(' · ')}
                      {ad.expiresAt && ` · Expira em ${expiryLabel(ad.expiresAt)}`}
                    </Text>
                  </Box>
                  {ad.commercial && (
                    <Button
                      as={Link}
                      to="/admin/parcerias?area=publicidade&tab=anunciantes"
                      size="small"
                    >
                      Ver campanha
                    </Button>
                  )}
                  {!ad.commercial && (
                    <RowActionsMenu
                      disabled={busyAdId !== null}
                      actions={[
                        {
                          key: 'edit',
                          label: 'Visualizar e editar',
                          icon: PencilIcon,
                          onSelect: () => setEditingAd(ad),
                        },
                        {
                          key: 'active',
                          label: ad.active ? 'Suspender' : 'Ativar',
                          icon: MegaphoneIcon,
                          onSelect: () => handleActive(ad, !ad.active),
                        },
                        ...(ad.deletable
                          ? [
                              {
                                key: 'delete',
                                label: 'Excluir',
                                icon: TrashIcon,
                                variant: 'danger',
                                onSelect: () => handleDelete(ad),
                              },
                            ]
                          : []),
                      ]}
                    />
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

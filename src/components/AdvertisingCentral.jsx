import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Button, Flash, Select, Spinner, Text } from '@primer/react'
import {
  getAdvertisingCampaigns,
  getAdvertisingCampaignsSummary,
} from '../services/advertisingService'
import { commercialError } from '../utils/commercial'
import { STATUS_LABELS } from '../utils/advertisingStatus'
import AdStatusCard from './advertising/AdStatusCard'
import CreateAdWizard from './advertising/CreateAdWizard'
import AdManagePage from './advertising/AdManagePage'

// As quatro situações primárias (seção 4.1 do prompt de reestruturação); as demais keys de
// STATUS_LABELS ficam no filtro complementar, para não transformar a listagem num painel
// cheio de abas.
const PRIMARY_FILTERS = [
  { value: null, label: 'Todos' },
  { value: 'live', label: 'Ativos' },
  { value: 'submitted', label: 'Em análise' },
  { value: 'ended', label: 'Encerrados' },
]
const COMPLEMENTARY_FILTERS = Object.keys(STATUS_LABELS).filter(
  (key) => !PRIMARY_FILTERS.some((item) => item.value === key)
)

export default function AdvertisingCentral({ accountId, accountName }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const managingId = searchParams.get('adId') || null
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [wizard, setWizard] = useState(null) // null | { editing: campaign|null }
  const [statusFilter, setStatusFilter] = useState(null)
  const [summary, setSummary] = useState(null)
  const [managedCampaign, setManagedCampaign] = useState(null)
  const [managedError, setManagedError] = useState('')

  function openManage(campaign) {
    const next = new URLSearchParams(searchParams)
    next.set('adId', campaign.ad_id)
    setSearchParams(next)
  }
  function closeManage() {
    const next = new URLSearchParams(searchParams)
    next.delete('adId')
    setSearchParams(next)
  }
  function viewResults(campaign) {
    const next = new URLSearchParams(searchParams)
    next.set('tab', 'results')
    next.set('adId', campaign.ad_id)
    setSearchParams(next)
  }

  useEffect(() => {
    if (!managingId) {
      setManagedCampaign(null)
      setManagedError('')
      return
    }
    let live = true
    setManagedError('')
    // Até 100 rascunhos por conta (ver AD_DRAFT_LIMIT): uma leitura completa e sem filtro
    // é sempre barata, e garante achar o anúncio mesmo que um filtro de status esteja ativo.
    getAdvertisingCampaigns(accountId)
      .then((all) => {
        if (!live) return
        const found = all.find((row) => row.ad_id === managingId)
        setManagedCampaign(found || null)
        if (!found) setManagedError('Anúncio não encontrado ou sem acesso.')
      })
      .catch((e) => live && setManagedError(commercialError(e)))
    return () => {
      live = false
    }
  }, [accountId, managingId])

  const refresh = useCallback(async () => {
    try {
      const current = await getAdvertisingCampaigns(accountId, null, statusFilter)
      setRows(current)
      setError('')
      return current
    } catch (e) {
      setError(commercialError(e))
      throw e
    }
  }, [accountId, statusFilter])

  useEffect(() => {
    let live = true
    setRows(null)
    setError('')
    getAdvertisingCampaigns(accountId, null, statusFilter)
      .then((data) => live && setRows(data))
      .catch((e) => live && setError(commercialError(e)))
    return () => {
      live = false
    }
  }, [accountId, statusFilter])

  useEffect(() => {
    // Resumo é só um complemento informativo: uma falha aqui nunca impede ver a lista real.
    let live = true
    setSummary(null)
    getAdvertisingCampaignsSummary(accountId)
      .then((data) => live && setSummary(data))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [accountId])

  if (wizard) {
    return (
      <CreateAdWizard
        accountId={accountId}
        accountName={accountName}
        existingDraft={wizard.editing}
        onCancel={() => setWizard(null)}
        onDone={async () => {
          setWizard(null)
          await refresh()
        }}
      />
    )
  }

  if (managingId) {
    if (managedError) return <Flash variant="danger">{managedError}</Flash>
    if (!managedCampaign) return <Spinner aria-label="Carregando anúncio" />
    return (
      <AdManagePage
        campaign={managedCampaign}
        onBack={closeManage}
        onEdit={(campaign) => setWizard({ editing: campaign })}
        onChange={refresh}
        onViewResults={viewResults}
      />
    )
  }

  return (
    <Box sx={{ minWidth: 0, maxWidth: 800, mx: 'auto' }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        {summary ? (
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
            Total: {summary.total} · Ativos: {summary.live} · Em análise: {summary.submitted}
          </Text>
        ) : (
          <Box />
        )}
        <Button variant="primary" onClick={() => setWizard({ editing: null })}>
          Criar anúncio
        </Button>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 2, alignItems: 'center' }}>
        {PRIMARY_FILTERS.map((item) => (
          <Button
            key={item.label}
            size="small"
            aria-pressed={statusFilter === item.value}
            variant={statusFilter === item.value ? 'primary' : 'default'}
            onClick={() => setStatusFilter(item.value)}
          >
            {item.label}
          </Button>
        ))}
        <Select
          aria-label="Outras situações"
          size="small"
          sx={{ width: 'auto', flexShrink: 0 }}
          value={COMPLEMENTARY_FILTERS.includes(statusFilter) ? statusFilter : ''}
          onChange={(e) => setStatusFilter(e.target.value || null)}
        >
          <Select.Option value="">Outras situações</Select.Option>
          {COMPLEMENTARY_FILTERS.map((key) => (
            <Select.Option key={key} value={key}>
              {STATUS_LABELS[key]}
            </Select.Option>
          ))}
        </Select>
      </Box>
      {error && (
        <Flash variant="danger" sx={{ mt: 2 }}>
          {error}
        </Flash>
      )}
      {!rows && !error && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <Spinner aria-label="Carregando seus anúncios" />
        </Box>
      )}
      {rows?.length === 0 && !statusFilter && (
        <Text as="p" sx={{ mt: 4, color: 'fg.muted', textAlign: 'center' }}>
          Você ainda não criou nenhum anúncio. Toque em "Criar anúncio" para começar.
        </Text>
      )}
      {rows?.length === 0 && statusFilter && (
        <Text as="p" sx={{ mt: 4, color: 'fg.muted', textAlign: 'center' }}>
          Nenhum anúncio nessa situação agora.
        </Text>
      )}
      {rows?.length > 0 && (
        <Box sx={{ mt: 2 }}>
          {rows.map((row) => (
            <AdStatusCard
              key={`${row.ad_id}:${row.version}:${row.moderation_state}`}
              campaign={row}
              onEdit={(campaign) => setWizard({ editing: campaign })}
              onManage={openManage}
            />
          ))}
        </Box>
      )}
      {rows?.length > 0 && rows.length % 20 === 0 && (
        <Button
          block
          onClick={async () => {
            try {
              const more = await getAdvertisingCampaigns(accountId, rows.at(-1).ad_id, statusFilter)
              setRows([...rows, ...more])
            } catch (e) {
              setError(commercialError(e))
            }
          }}
        >
          Carregar mais anúncios
        </Button>
      )}
    </Box>
  )
}

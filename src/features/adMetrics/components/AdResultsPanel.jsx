import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Flash, Spinner, Text } from '@primer/react'
import { readCatalog } from '../api/advertisers.api'
import { CampaignIdentity } from './CampaignIdentity'
import AdMetricsTab from './AdMetricsTab'

// Everything here is report-only: loaded lazily, after the advertiser opens "Resultados",
// never on the default "Meus anúncios" load (see src/pages/MyAds.jsx).
export default function AdResultsPanel({ userId, accountId }) {
  const [params, setParams] = useSearchParams()
  const [campaigns, setCampaigns] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setCampaigns(null)
    setError('')
    readCatalog('list_advertiser_campaigns', { p_account_id: accountId })
      .then((rows) => {
        if (live) setCampaigns({ accountId, rows })
      })
      .catch(() => {
        if (live) {
          setCampaigns(null)
          setError('Acesso negado ou relatório indisponível. Nenhum dado foi carregado.')
        }
      })
    return () => {
      live = false
    }
  }, [accountId])
  const initialFilters = Object.fromEntries(
    ['adId', 'communityId', 'placement', 'from', 'to'].map((k) => [k, params.get(k) || null])
  )
  initialFilters.days = Number(params.get('days')) || 30

  if (error)
    return (
      <Flash variant="danger" sx={{ mt: 3 }}>
        {error}
      </Flash>
    )
  if (!campaigns || campaigns.accountId !== accountId)
    return <Spinner aria-label="Carregando resultados" />
  return (
    <>
      <Text sx={{ display: 'block', fontSize: 0, mb: 2 }}>
        Relatórios exigem login e autorização. A gestão depende do seu papel na conta.
      </Text>
      {campaigns.rows.find((c) => c.id === initialFilters.adId) && (
        <CampaignIdentity campaign={campaigns.rows.find((c) => c.id === initialFilters.adId)} />
      )}
      <AdMetricsTab
        key={params.toString()}
        userId={userId}
        accountId={accountId}
        initialFilters={initialFilters}
        onAccessDenied={() => {
          setCampaigns(null)
          setError('Acesso negado a esta conta ou campanha.')
        }}
        ads={campaigns.rows.map((c) => ({
          id: c.id,
          title: `${c.title || 'Campanha histórica'}${c.deleted ? ' (removida — material indisponível)' : ''}`,
          partnerName: c.partner_name,
        }))}
        communities={[]}
        onFiltersChange={(filters) => {
          const next = { accountId, tab: 'results' }
          for (const k of ['adId', 'communityId', 'placement', 'days', 'from', 'to'])
            if (filters[k] != null) next[k] = String(filters[k])
          setParams(next, { replace: true })
        }}
      />
    </>
  )
}

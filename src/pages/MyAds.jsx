import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Heading, Select, Flash, Spinner, Text } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { readCatalog } from '../features/adMetrics/api/advertisers.api'
import { CampaignIdentity } from '../features/adMetrics/components/CampaignIdentity'
import AdMetricsTab from '../features/adMetrics/components/AdMetricsTab'

export default function MyAds() {
  const { user } = useAuth()
  return <AdvertiserPortal key={user?.uid} userId={user?.uid} />
}
function AdvertiserPortal({ userId }) {
  const [params, setParams] = useSearchParams()
  const accountId = params.get('accountId') || ''
  const [accounts, setAccounts] = useState(null)
  const [campaigns, setCampaigns] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    readCatalog('list_advertiser_accounts')
      .then((rows) => {
        if (live) setAccounts(rows)
      })
      .catch(() => {
        if (live) {
          setAccounts([])
          setError('Não foi possível consultar suas contas. Verifique a conexão e sua autorização.')
        }
      })
    return () => {
      live = false
    }
  }, [userId])
  useEffect(() => {
    let live = true
    setCampaigns(null)
    setError('')
    if (accountId)
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
  const account = accounts?.find((a) => a.id === accountId)
  const initialFilters = Object.fromEntries(
    ['adId', 'communityId', 'placement', 'from', 'to'].map((k) => [k, params.get(k) || null])
  )
  initialFilters.days = Number(params.get('days')) || 30
  return (
    <Box>
      <Heading as="h1" sx={{ fontSize: 3, mb: 3 }}>
        Meus anúncios
      </Heading>
      {error && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}
      {!accounts && <Spinner aria-label="Carregando contas" />}
      {accounts?.length === 0 && !error && <Text>Nenhuma conta de anunciante autorizada.</Text>}
      {accounts?.length > 0 && (
        <Select
          aria-label="Conta de anunciante"
          block
          value={accountId}
          onChange={(e) => setParams(e.target.value ? { accountId: e.target.value } : {})}
        >
          <Select.Option value="">Selecione uma conta</Select.Option>
          {accounts.map((a) => (
            <Select.Option key={a.id} value={a.id}>
              {a.name}
              {!a.active ? ' (desativada)' : ''}
            </Select.Option>
          ))}
        </Select>
      )}
      {accountId && accounts && !account && (
        <Flash variant="danger" sx={{ mt: 3 }}>
          Acesso negado.
        </Flash>
      )}
      {account && !campaigns && !error && <Spinner aria-label="Carregando campanhas" />}
      {account && campaigns?.accountId === accountId && (
        <Box sx={{ mt: 3 }}>
          <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
            {account.name}
          </Heading>
          <Text sx={{ display: 'block', fontSize: 0, mb: 2 }}>
            Acesso somente de leitura. Compartilhamento exige login e autorização.
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
              const next = { accountId }
              for (const k of ['adId', 'communityId', 'placement', 'days', 'from', 'to'])
                if (filters[k] != null) next[k] = String(filters[k])
              setParams(next, { replace: true })
            }}
          />
        </Box>
      )}
    </Box>
  )
}

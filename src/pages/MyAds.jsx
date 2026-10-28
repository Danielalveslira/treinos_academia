import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Heading, Select, Flash, Spinner, Text } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { readCatalog } from '../features/adMetrics/api/advertisers.api'
import { CampaignIdentity } from '../features/adMetrics/components/CampaignIdentity'
import AdMetricsTab from '../features/adMetrics/components/AdMetricsTab'
import { Button, FormControl, TextInput } from '@primer/react'
import { createAdvertisingAccount } from '../services/advertisingService'
const AdvertisingCentral = lazy(() => import('../components/AdvertisingCentral'))

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
  const [accountName, setAccountName] = useState('')
  const accountLock = useRef(false)
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
      {import.meta.env.DEV && import.meta.env.VITE_FINANCE_LOCAL_PREVIEW === 'true' && (
        <Flash sx={{ my: 3 }}>
          Ambiente local de homologação. Campanhas, preços e métricas são sintéticos; não
          representam cobranças ou audiência reais.
        </Flash>
      )}
      {error && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}
      {!accounts && <Spinner aria-label="Carregando contas" />}
      {accounts?.length === 0 && !error && (
        <Box
          as="form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (accountLock.current) return
            accountLock.current = true
            try {
              const id = await createAdvertisingAccount(accountName)
              setAccounts(await readCatalog('list_advertiser_accounts'))
              setParams({ accountId: id })
            } catch (err) {
              setError(err.message)
            } finally {
              accountLock.current = false
            }
          }}
        >
          <FormControl required>
            <FormControl.Label>Nome do anunciante</FormControl.Label>
            <TextInput
              block
              maxLength={120}
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />
          </FormControl>
          <Button type="submit" disabled={!accountName.trim()} sx={{ mt: 2 }}>
            Criar minha conta de anunciante
          </Button>
        </Box>
      )}
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
            Relatórios exigem login e autorização. A gestão depende do seu papel na conta.
          </Text>
          {campaigns.rows.find((c) => c.id === initialFilters.adId) && (
            <CampaignIdentity campaign={campaigns.rows.find((c) => c.id === initialFilters.adId)} />
          )}
          <Suspense fallback={<Spinner aria-label="Carregando central" />}>
            {account.can_manage && <AdvertisingCentral key={accountId} accountId={accountId} />}
          </Suspense>
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

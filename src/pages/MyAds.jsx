import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Heading, Select, Flash, Spinner, Text, UnderlineNav } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { readCatalog } from '../features/adMetrics/api/advertisers.api'
import { Button, FormControl, TextInput } from '@primer/react'
import { createAdvertisingAccount } from '../services/advertisingService'
import { commercialError } from '../utils/commercial'
const AdvertisingCentral = lazy(() => import('../components/AdvertisingCentral'))
const AdResultsPanel = lazy(() => import('../features/adMetrics/components/AdResultsPanel'))

// "Campanhas" (não "Meus anúncios" de novo) para não repetir o próprio título da página
// logo abaixo do H1 -- a mesma informação duas vezes só ocupa espaço na tela pequena.
const TABS = [
  { key: 'campaigns', label: 'Campanhas' },
  { key: 'results', label: 'Resultados' },
]

export default function MyAds() {
  const { user } = useAuth()
  return <AdvertiserPortal key={user?.uid} userId={user?.uid} />
}
function AdvertiserPortal({ userId }) {
  const [params, setParams] = useSearchParams()
  const accountId = params.get('accountId') || ''
  const [tab, setTab] = useState(params.get('tab') === 'results' ? 'results' : 'campaigns')
  const [resultsOpened, setResultsOpened] = useState(tab === 'results')
  const [accounts, setAccounts] = useState(null)
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
  const account = accounts?.find((a) => a.id === accountId)
  useEffect(() => {
    // A single account needs no explicit choice: pick it silently so a user with one
    // account never has to understand "conta de anúncios".
    if (accounts?.length === 1 && !accountId) setParams({ accountId: accounts[0].id })
  }, [accounts, accountId, setParams])
  return (
    <Box>
      <Heading as="h1" sx={{ fontSize: 3, mb: 2 }}>
        Meus anúncios
      </Heading>
      {import.meta.env.DEV && import.meta.env.VITE_FINANCE_LOCAL_PREVIEW === 'true' && (
        <Flash sx={{ mb: 2 }}>
          Ambiente local de homologação. Campanhas, preços e métricas são sintéticos; não
          representam cobranças ou audiência reais.
        </Flash>
      )}
      {error && (
        <Flash variant="danger" sx={{ mb: 2 }}>
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
              setError(commercialError(err))
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
      {accounts?.length > 1 && (
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
      {account && (
        <Box sx={{ mt: 2 }}>
          <UnderlineNav aria-label="Seções de Meus anúncios" sx={{ mb: 2 }}>
            {TABS.map((item) => (
              <UnderlineNav.Item
                key={item.key}
                as="button"
                aria-current={tab === item.key ? 'page' : undefined}
                onSelect={() => {
                  setTab(item.key)
                  setParams({ accountId, tab: item.key }, { replace: true })
                  if (item.key === 'results') setResultsOpened(true)
                }}
              >
                {item.label}
              </UnderlineNav.Item>
            ))}
          </UnderlineNav>

          <Box hidden={tab !== 'campaigns'}>
            <Suspense fallback={<Spinner aria-label="Carregando anúncios" />}>
              {account.can_manage ? (
                <AdvertisingCentral
                  key={accountId}
                  accountId={accountId}
                  accountName={account.name}
                />
              ) : (
                <Text as="p">Sua conta não tem permissão para gerenciar campanhas.</Text>
              )}
            </Suspense>
          </Box>

          {resultsOpened && (
            <Box hidden={tab !== 'results'}>
              <Suspense fallback={<Spinner aria-label="Carregando resultados" />}>
                <AdResultsPanel userId={userId} accountId={accountId} />
              </Suspense>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

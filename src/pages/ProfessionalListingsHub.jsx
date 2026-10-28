import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Box,
  Button,
  Flash,
  FormControl,
  Heading,
  Label,
  Select,
  Spinner,
  Text,
} from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { UsageProfileField } from '../components/UsageProfileField'
import { setUsageProfile } from '../services/usageProfileService'
import { isEligibleForListingCreation } from '../constants/usageProfile'
import {
  createProfessionalListing,
  listMyProfessionalListings,
  getProfessionalListingLimits,
} from '../services/professionalListingsService'
import { commercialDate } from '../utils/commercial'
import { editorialLabels, publicationLabels, storefrontError } from '../utils/storefront'
const Editor = lazy(() => import('./MyProfessionalListing'))
const kindLabel = (k) => (k === 'space' ? 'Estabelecimento' : 'Profissional')
export default function ProfessionalListingsHub() {
  const { user, profile, refreshProfile } = useAuth(),
    [params, setParams] = useSearchParams(),
    id = params.get('cadastro')
  const [kind, setKind] = useState(''),
    [before, setBefore] = useState(null),
    [page, setPage] = useState(null),
    [limits, setLimits] = useState([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0)
  const lock = useRef(false),
    intent = useRef(null)
  useEffect(() => {
    if (id) return
    let active = true
    const started = performance.now()
    setLoading(true)
    setPage(null)
    setError('')
    Promise.all([listMyProfessionalListings(kind || null, before), getProfessionalListingLimits()])
      .then(([p, l]) => {
        if (active) {
          setPage({ ...p, receivedAt: performance.now(), transitMs: performance.now() - started })
          setLimits(l)
        }
      })
      .catch((e) => active && setError(storefrontError(e)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [id, kind, before, refresh])
  useEffect(() => {
    const deadlines = (page?.items || [])
      .filter((item) => item.state === 'active')
      .map(
        (item) =>
          Date.parse(item.expiresAt) -
          Date.parse(page.serverTime) -
          page.transitMs -
          (performance.now() - page.receivedAt)
      )
      .filter(Number.isFinite)
    if (!deadlines.length) return
    const timer = setTimeout(
      () => setRefresh((n) => n + 1),
      Math.min(Math.max(0, Math.min(...deadlines)), 2147483647)
    )
    return () => clearTimeout(timer)
  }, [page])
  async function declareUsage(value) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await setUsageProfile(value)
      await refreshProfile(user.uid)
    } catch (e) {
      setError(storefrontError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function create(k) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    if (intent.current?.kind !== k) intent.current = { kind: k, id: crypto.randomUUID() }
    try {
      const result = await createProfessionalListing(k, intent.current.id)
      intent.current = null
      setParams({ cadastro: result.listingId })
    } catch (e) {
      setError(storefrontError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  if (id)
    return (
      <Suspense fallback={<Spinner aria-label="Carregando cadastro" />}>
        <Editor key={id} listingId={id} />
      </Suspense>
    )
  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', minWidth: 0, display: 'grid', gap: 3, pb: 4 }}>
      <Heading as="h1" sx={{ fontSize: 3 }}>
        Meus perfis e estabelecimentos
      </Heading>
      <Text as="p">
        Prepare gratuitamente. Cada cadastro possui aprovação, contratação e vencimento próprios.
      </Text>
      {error && <Flash variant="danger">{error}</Flash>}
      {!isEligibleForListingCreation(profile?.usageProfile) ? (
        <Box>
          <Text as="p">Informe seu perfil de uso para criar cadastros.</Text>
          <UsageProfileField
            value={profile?.usageProfile || ''}
            onChange={declareUsage}
            disabled={busy}
          />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {['professional', 'space'].map((k) => (
            <Button
              key={k}
              disabled={
                busy ||
                loading ||
                !limits.some((l) => l.kind === k) ||
                limits.find((l) => l.kind === k)?.maxPerOwner === 0
              }
              onClick={() => create(k)}
            >
              {k === 'space' ? 'Criar estabelecimento' : 'Criar perfil profissional'}
            </Button>
          ))}
          {!loading && limits.length < 2 && (
            <Text as="p">
              A criação dos tipos sem limite configurado aguarda liberação administrativa. Cadastros
              existentes continuam disponíveis.
            </Text>
          )}
        </Box>
      )}
      <FormControl>
        <FormControl.Label>Tipo de cadastro</FormControl.Label>
        <Select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value)
            setBefore(null)
          }}
        >
          <Select.Option value="">Todos</Select.Option>
          <Select.Option value="professional">Profissionais</Select.Option>
          <Select.Option value="space">Estabelecimentos</Select.Option>
        </Select>
      </FormControl>
      <Button disabled={loading || busy} onClick={() => setRefresh((n) => n + 1)}>
        Atualizar cadastros
      </Button>
      {loading && <Spinner aria-label="Carregando cadastros" />}
      {!loading && page?.items?.length === 0 && <Text as="p">Nenhum cadastro nesta página.</Text>}
      {page?.items?.map((item) => (
        <Box
          key={item.id}
          sx={{
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            p: 3,
            minWidth: 0,
            overflowWrap: 'anywhere',
          }}
        >
          <Heading as="h2" sx={{ fontSize: 2 }}>
            {item.displayName}
          </Heading>
          <Text as="p">{kindLabel(item.kind)}</Text>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Label>{editorialLabels[item.reviewState] || item.reviewState}</Label>
            <Label>{publicationLabels[item.state] || item.state}</Label>
          </Box>
          {item.expiresAt && (
            <Text as="p">
              Vencimento: {commercialDate(item.expiresAt)} ·{' '}
              {Math.max(
                0,
                Math.ceil((Date.parse(item.expiresAt) - Date.parse(page.serverTime)) / 86400000)
              )}{' '}
              dia(s) restantes na consulta.
            </Text>
          )}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              as={Link}
              to={'?cadastro=' + item.id}
              aria-label={'Gerenciar ' + item.displayName}
            >
              Gerenciar
            </Button>
            <Button
              as={Link}
              to={'?cadastro=' + item.id + '#publicacao'}
              aria-label={'Contratar ou renovar ' + item.displayName}
            >
              Contratar ou renovar
            </Button>
          </Box>
        </Box>
      ))}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {before && (
          <Button disabled={loading} onClick={() => setBefore(null)}>
            Primeira página
          </Button>
        )}
        {page?.nextCursor && (
          <Button disabled={loading} onClick={() => setBefore(page.nextCursor)}>
            Próxima página
          </Button>
        )}
      </Box>
    </Box>
  )
}

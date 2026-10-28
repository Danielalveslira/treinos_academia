import { useState, useRef } from 'react'
import {
  Box,
  Heading,
  Text,
  Button,
  Spinner,
  Dialog,
  FormControl,
  TextInput,
  Textarea,
  Select,
  Checkbox,
  Flash,
  Label,
} from '@primer/react'
import ProfessionalListingLimitsAdmin from '../components/ProfessionalListingLimitsAdmin'
import AdminNav from '../components/AdminNav'
import StorefrontImage from '../components/StorefrontImage'
import CommercialOrderHistory from '../components/CommercialOrderHistory'
import { useAdminProfessionalListings } from '../hooks/useAdminProfessionalListings'
import {
  adminGetProfessionalListing,
  setProfessionalListingEditorial,
  listListingCommercialOrders,
} from '../services/professionalListingsService'
import { reauthenticatePricingAdmin } from '../services/evocashPricingService'
import { commercialDate } from '../utils/commercial'
import { storefrontError, editorialLabels, publicationLabels } from '../utils/storefront'
export default function AdminProfessionalListings() {
  const [showLimits, setShowLimits] = useState(false)
  const [search, setSearch] = useState(''),
    [state, setState] = useState(''),
    [detail, setDetail] = useState(null),
    [dialog, setDialog] = useState(false),
    [decision, setDecision] = useState('approved'),
    [reason, setReason] = useState(''),
    [password, setPassword] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const request = useRef(0),
    lock = useRef(false)
  const {
    listings,
    loading,
    error: listError,
    hasMore,
    loadMore,
    refresh,
  } = useAdminProfessionalListings(search, state)
  async function inspect(id) {
    const generation = ++request.current
    setError('')
    setDetail(null)
    try {
      const row = await adminGetProfessionalListing(id)
      if (generation === request.current) setDetail(row)
    } catch (e) {
      if (generation === request.current) setError(storefrontError(e))
    }
  }
  async function moderate(e) {
    e.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await reauthenticatePricingAdmin(password)
      await setProfessionalListingEditorial(detail.id, detail.draft.version, decision, reason)
      setPassword('')
      setDialog(false)
      await inspect(detail.id)
      await refresh()
    } catch (e) {
      setError(storefrontError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function open() {
    setDecision('approved')
    setReason('')
    setPassword('')
    setConfirmed(false)
    setError('')
    setDialog(true)
  }
  return (
    <Box sx={{ minWidth: 0 }}>
      <AdminNav current="/admin/vitrines" currentLabel="Vitrines" />
      <Heading as="h1" sx={{ fontSize: 3 }}>
        Profissionais e estabelecimentos
      </Heading>
      <Text as="p">
        Aprovação editorial e direito comercial são independentes. Moderar não cobra nem concede
        prazo.
      </Text>
      <Button aria-expanded={showLimits} onClick={() => setShowLimits((v) => !v)}>
        Configurar limites de cadastros
      </Button>
      {showLimits && <ProfessionalListingLimitsAdmin />}
      {error && <Flash variant="danger">{error}</Flash>}
      {listError && <Flash variant="danger">Não foi possível carregar a lista.</Flash>}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', my: 3 }}>
        <FormControl sx={{ flex: 1, minWidth: 160 }}>
          <FormControl.Label>Buscar cadastro</FormControl.Label>
          <TextInput block value={search} onChange={(e) => setSearch(e.target.value)} />
        </FormControl>
        <FormControl>
          <FormControl.Label>Estado do cadastro</FormControl.Label>
          <Select value={state} onChange={(e) => setState(e.target.value)}>
            {[
              ['', 'Todos'],
              ['draft', 'Rascunho'],
              ['published', 'Versão aprovada'],
              ['archived', 'Arquivado'],
              ['suspended', 'Suspenso'],
            ].map(([v, l]) => (
              <Select.Option value={v} key={v}>
                {l}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Button disabled={loading || busy} onClick={refresh}>
        Atualizar lista
      </Button>
      {loading && <Spinner aria-label="Carregando cadastros" />}
      <Box sx={{ display: 'grid', gap: 2, my: 3 }}>
        {listings.map((row) => (
          <Box
            key={row.id}
            sx={{
              border: '1px solid',
              borderColor: 'border.default',
              p: 3,
              borderRadius: 2,
              minWidth: 0,
              overflowWrap: 'anywhere',
            }}
          >
            <Text as="p">
              {row.displayName || 'Cadastro em preparação'} ·{' '}
              {row.kind === 'space' ? 'Estabelecimento' : 'Profissional'}
            </Text>
            <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
              Titular: {row.ownerUsername || row.ownerEmail || row.ownerId}
            </Text>
            <Button
              aria-label={`Revisar ${row.displayName || row.id}`}
              disabled={busy}
              onClick={() => inspect(row.id)}
            >
              Revisar cadastro
            </Button>
          </Box>
        ))}
      </Box>
      {hasMore && (
        <Button disabled={loading} onClick={loadMore}>
          Mais cadastros
        </Button>
      )}
      {detail && (
        <Box sx={{ borderTop: '1px solid', borderColor: 'border.default', pt: 3, minWidth: 0 }}>
          <Heading as="h2" sx={{ fontSize: 2 }}>
            Revisão de {detail.draft.displayName || detail.id}
          </Heading>
          <Text as="p" sx={{ overflowWrap: 'anywhere' }}>
            Titular: {detail.ownerEmail || detail.listing.ownerId} · ID: {detail.id}
          </Text>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Label>{editorialLabels[detail.draft.reviewState]}</Label>
            <Label>{publicationLabels[detail.commercial.state]}</Label>
          </Box>
          <Text as="p">
            Vencimento: {commercialDate(detail.commercial.expiresAt)} · revisão{' '}
            {detail.draft.version}
          </Text>
          <Box
            sx={{ display: 'grid', gridTemplateColumns: ['1fr', '1fr', '1fr 1fr'], gap: 3, my: 3 }}
          >
            {[
              ['Versão em edição', detail.draft],
              ['Última versão aprovada', detail.published],
            ].map(([title, row]) => (
              <Box
                key={title}
                sx={{
                  border: '1px solid',
                  borderColor: 'border.default',
                  p: 3,
                  borderRadius: 2,
                  overflowWrap: 'anywhere',
                }}
              >
                <Heading as="h3" sx={{ fontSize: 1 }}>
                  {title}
                </Heading>
                {row ? (
                  <>
                    <StorefrontImage id={row.mediaId} alt={title} size={96} />
                    <Text as="p">{row.displayName}</Text>
                    <Text as="p">{row.bio}</Text>
                    <Text as="p">
                      {row.city} · {row.uf}
                    </Text>
                    <Text as="p">{row.address}</Text>
                    <Text as="p">{row.openingHours}</Text>
                    <Text as="p">{(row.specialties || []).join(', ')}</Text>
                    <Text as="p">{JSON.stringify(row.contacts || row.publicContacts)}</Text>
                  </>
                ) : (
                  <Text as="p">Nenhuma versão aprovada.</Text>
                )}
              </Box>
            ))}
          </Box>
          <Button disabled={busy} onClick={open}>
            Moderar cadastro
          </Button>
          <CommercialOrderHistory
            resourceId={detail.id}
            load={listListingCommercialOrders}
            revision={detail.commercial.expiresAt}
          />
          <details>
            <summary>Eventos de auditoria</summary>
            {detail.events?.map((event) => (
              <Box key={event.id} sx={{ my: 2, overflowWrap: 'anywhere' }}>
                <Text as="p">
                  {event.action} · {event.reason} · {event.occurred_at}
                </Text>
                <Box as="pre" sx={{ fontSize: 0, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(event.payload, null, 2)}
                </Box>
              </Box>
            ))}
          </details>
        </Box>
      )}
      {dialog && (
        <Dialog
          title="Moderar cadastro"
          onClose={() => {
            if (!busy) {
              setDialog(false)
              setPassword('')
            }
          }}
        >
          <Box as="form" onSubmit={moderate} sx={{ p: 3, display: 'grid', gap: 3 }}>
            <FormControl>
              <FormControl.Label>Decisão</FormControl.Label>
              <Select
                block
                value={decision}
                onChange={(e) => {
                  setDecision(e.target.value)
                  setConfirmed(false)
                }}
              >
                {[
                  ['approved', 'Aprovar'],
                  ['rejected', 'Reprovar'],
                  ['suspended', 'Suspender'],
                  ['draft', 'Devolver a rascunho'],
                  ['archived', 'Arquivar'],
                ].map(([v, l]) => (
                  <Select.Option key={v} value={v}>
                    {l}
                  </Select.Option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label>Justificativa</FormControl.Label>
              <Textarea
                block
                maxLength={500}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value)
                  setConfirmed(false)
                }}
              />
            </FormControl>
            <FormControl>
              <FormControl.Label>Confirme sua senha</FormControl.Label>
              <TextInput
                block
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormControl>
            <FormControl>
              <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <FormControl.Label>Confirmo esta decisão auditada</FormControl.Label>
            </FormControl>
            {error && <Flash variant="danger">{error}</Flash>}
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !confirmed || !password || reason.trim().length < 5}
            >
              Confirmar decisão
            </Button>
          </Box>
        </Dialog>
      )}
    </Box>
  )
}

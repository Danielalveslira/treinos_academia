import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  Flash,
  FormControl,
  Heading,
  Label,
  Spinner,
  Text,
  TextInput,
  Textarea,
} from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  getAdvertisingCampaigns,
  reviewAdvertisingCampaign,
  getCommercialPromotions,
  reviewCommercialPromotion,
} from '../services/advertisingService'
import { listStorefronts, setStorefrontEditorial } from '../services/storefrontService'
import { reauthenticatePricingAdmin } from '../services/evocashPricingService'
import { commercialError } from '../utils/commercial'
import { storefrontError } from '../utils/storefront'
import { TYPE_LABELS, STATUS_LABELS, buildApprovalItems, filterApprovalItems } from '../utils/approvalsQueue'
import StorefrontImage from './StorefrontImage'

const STATUS_FILTERS = [
  { key: 'pending', label: 'Pendentes' },
  { key: 'approved', label: 'Aprovadas' },
  { key: 'rejected', label: 'Reprovadas' },
  { key: 'all', label: 'Todas' },
]
const TYPE_FILTERS = [
  { key: 'all', label: 'Todos os tipos' },
  { key: 'ad', label: 'Anúncios' },
  { key: 'storefront', label: 'Vitrines' },
  { key: 'boost', label: 'Impulsionamentos' },
]

const emptySource = { state: 'loading', rows: [] }

export default function ApprovalsQueue() {
  const [ads, setAds] = useState(emptySource)
  const [storefronts, setStorefronts] = useState(emptySource)
  const [boosts, setBoosts] = useState(emptySource)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [typeFilter, setTypeFilter] = useState('all')
  const [reviewing, setReviewing] = useState(null)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const lock = useRef(false)

  function loadAds() {
    setAds(emptySource)
    getAdvertisingCampaigns(null).then(
      (rows) => setAds({ state: 'ready', rows }),
      () => setAds({ state: 'error', rows: [] })
    )
  }
  function loadStorefronts() {
    setStorefronts(emptySource)
    listStorefronts(true).then(
      (page) => setStorefronts({ state: 'ready', rows: page.items }),
      () => setStorefronts({ state: 'error', rows: [] })
    )
  }
  function loadBoosts() {
    setBoosts(emptySource)
    getCommercialPromotions().then(
      (rows) => setBoosts({ state: 'ready', rows }),
      () => setBoosts({ state: 'error', rows: [] })
    )
  }
  // Cada categoria carrega e falha de forma independente -- a central nunca trava por
  // uma consulta lenta ou indisponível em outro domínio.
  useEffect(() => {
    loadAds()
    loadStorefronts()
    loadBoosts()
  }, [])

  const items = filterApprovalItems(
    buildApprovalItems({
      ads: ads.state === 'ready' ? ads.rows : [],
      storefronts: storefronts.state === 'ready' ? storefronts.rows : [],
      boosts: boosts.state === 'ready' ? boosts.rows : [],
    }),
    { statusFilter, typeFilter }
  )

  const anyLoading =
    ads.state === 'loading' || storefronts.state === 'loading' || boosts.state === 'loading'
  const anyError = ads.state === 'error' || storefronts.state === 'error' || boosts.state === 'error'

  function openReview(item) {
    setReviewing(item)
    setReason('')
    setPassword('')
    setDialogError('')
  }

  async function decide(approve) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setDialogError('')
    try {
      if (reason.trim().length < 5)
        throw new Error('Informe uma justificativa de pelo menos cinco caracteres.')
      await reauthenticatePricingAdmin(password)
      if (reviewing.type === 'ad') {
        await reviewAdvertisingCampaign(reviewing.raw, approve, reason)
        loadAds()
      } else if (reviewing.type === 'storefront') {
        await setStorefrontEditorial(reviewing.raw, approve ? 'approved' : 'rejected', reason)
        loadStorefronts()
      } else {
        await reviewCommercialPromotion(reviewing.raw.id, approve, reason)
        loadBoosts()
      }
      setReviewing(null)
      setPassword('')
    } catch (e) {
      setDialogError(reviewing.type === 'storefront' ? storefrontError(e) : commercialError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <Box>
      <Text as="p" sx={{ color: 'fg.muted', mt: 0 }}>
        Revise anúncios, vitrines e impulsionamentos enviados para aprovação. Aprovar não publica
        nem contrata automaticamente: a exibição depende de contratação e elegibilidade vigentes.
      </Text>
      <Box
        role="group"
        aria-label="Filtrar por status"
        sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}
      >
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={statusFilter === f.key ? 'primary' : 'default'}
            aria-current={statusFilter === f.key ? 'true' : undefined}
            onClick={() => setStatusFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </Box>
      <Box
        role="group"
        aria-label="Filtrar por tipo"
        sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}
      >
        {TYPE_FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={typeFilter === f.key ? 'primary' : 'default'}
            aria-current={typeFilter === f.key ? 'true' : undefined}
            onClick={() => setTypeFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </Box>
      {anyError && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          Não foi possível consultar uma ou mais categorias. As demais continuam disponíveis.
        </Flash>
      )}
      {anyLoading && items.length === 0 && <Spinner aria-label="Carregando aprovações" />}
      {!anyLoading && items.length === 0 && (
        <Blankslate>
          <Blankslate.Heading>Nenhuma solicitação nesta visão</Blankslate.Heading>
          <Blankslate.Description>Ajuste os filtros ou volte depois.</Blankslate.Description>
        </Blankslate>
      )}
      {items.length > 0 && (
        <Box
          sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, overflow: 'hidden' }}
        >
          {items.map((item, index) => (
            <Box
              key={item.key}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 3,
                py: 2,
                flexWrap: 'wrap',
                borderTop: index === 0 ? 'none' : '1px solid',
                borderColor: 'border.default',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Label>{TYPE_LABELS[item.type]}</Label>
                  <Text sx={{ fontWeight: 'bold' }}>{item.title}</Text>
                  {item.suspended && <Label variant="danger">Suspenso</Label>}
                </Box>
                <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                  {item.subtitle} · {STATUS_LABELS[item.status] || item.status}
                </Text>
              </Box>
              <Button onClick={() => openReview(item)}>
                {item.status === 'submitted' ? 'Revisar' : 'Ver detalhes'}
              </Button>
            </Box>
          ))}
        </Box>
      )}
      {reviewing && (
        <Dialog
          title={`Revisar ${TYPE_LABELS[reviewing.type].toLowerCase()}`}
          onClose={() => {
            if (!busy) setReviewing(null)
          }}
          width="large"
        >
          <Box sx={{ p: 3, overflowWrap: 'anywhere' }}>
            <Heading as="h3" sx={{ fontSize: 2 }}>
              {reviewing.title}
            </Heading>
            <Text as="p" sx={{ color: 'fg.muted' }}>
              {reviewing.subtitle} · {STATUS_LABELS[reviewing.status] || reviewing.status}
              {reviewing.suspended ? ' · Suspenso na veiculação' : ''}
            </Text>
            {reviewing.type === 'ad' && (
              <>
                <Text as="p">{reviewing.raw.description}</Text>
                {reviewing.raw.media_id && <StorefrontImage id={reviewing.raw.media_id} size={160} />}
                <Text as="p">Destino: {reviewing.raw.destination}</Text>
                {reviewing.raw.placements?.length > 0 && (
                  <Text as="p">Posições: {reviewing.raw.placements.map((p) => p.code).join(' · ')}</Text>
                )}
              </>
            )}
            {reviewing.type === 'storefront' && (
              <>
                <StorefrontImage id={reviewing.raw.logoMediaId} alt={reviewing.raw.name} />
                <Text as="p">{reviewing.raw.description}</Text>
                <Text as="p">{reviewing.raw.contact}</Text>
              </>
            )}
            {reviewing.type === 'boost' && (
              <Text as="p">
                {reviewing.raw.cash_amount} EvoCash · {reviewing.raw.duration_days} dias
              </Text>
            )}
            {reviewing.status === 'submitted' ? (
              <>
                <FormControl sx={{ mt: 3 }} required>
                  <FormControl.Label>Justificativa da decisão</FormControl.Label>
                  <Textarea
                    block
                    maxLength={500}
                    disabled={busy}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </FormControl>
                <FormControl sx={{ mt: 2 }} required>
                  <FormControl.Label>Confirme sua senha</FormControl.Label>
                  <TextInput
                    block
                    type="password"
                    autoComplete="current-password"
                    disabled={busy}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </FormControl>
                {dialogError && (
                  <Flash variant="danger" sx={{ mt: 2 }}>
                    {dialogError}
                  </Flash>
                )}
                <Box sx={{ display: 'flex', gap: 2, mt: 3, flexWrap: 'wrap' }}>
                  <Button disabled={busy} onClick={() => setReviewing(null)}>
                    Cancelar
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy || reason.trim().length < 5 || !password}
                    onClick={() => decide(false)}
                  >
                    {busy ? 'Enviando…' : 'Reprovar'}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy || reason.trim().length < 5 || !password}
                    onClick={() => decide(true)}
                  >
                    {busy ? 'Enviando…' : 'Aprovar'}
                  </Button>
                </Box>
              </>
            ) : (
              <Text as="p" sx={{ mt: 3, color: 'fg.muted' }}>
                Esta solicitação já foi decidida. Suspensões, retomadas e revogações continuam no
                painel completo da categoria.
              </Text>
            )}
          </Box>
        </Dialog>
      )}
    </Box>
  )
}

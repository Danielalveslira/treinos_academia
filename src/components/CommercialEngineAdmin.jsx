import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  Flash,
  FormControl,
  Heading,
  Label,
  Select,
  Spinner,
  Text,
  Textarea,
  TextInput,
} from '@primer/react'
import {
  getCommercialCatalog,
  listCommercial,
  publishCommercialPrice,
  reverseCommercialOrder,
  setCommercialEntitlement,
  setCommercialSales,
} from '../services/commercialService'
import { reauthenticatePricingAdmin } from '../services/evocashPricingService'
import { AuthCaptcha } from './AuthCaptcha'
import { authCaptchaRequired, takeCaptchaToken } from '../utils/authCaptcha'
import { commercialDate, commercialError, validCommercialPrice } from '../utils/commercial'
const LocalContractPreview = lazy(() => import('./CommercialContractPreview'))
const tabs = {
  catalog: 'Serviços',
  prices: 'Preços',
  orders: 'Pedidos',
  rights: 'Publicações contratadas',
  events: 'Histórico de operações',
}
const stateLabels = {
  active: 'Ativo',
  expired: 'Vencido',
  suspended: 'Suspenso',
  revoked: 'Revogado',
  ineligible: 'Inelegível',
  quoted: 'Cotado',
  fulfilled: 'Contratado',
  reversed: 'Estornado',
}

export default function CommercialEngineAdmin() {
  const [catalog, setCatalog] = useState([])
  const [code, setCode] = useState('')
  const [tab, setTab] = useState('catalog')
  const [page, setPage] = useState({ items: [], nextCursor: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [cursor, setCursor] = useState(null)
  const [action, setAction] = useState(null)
  const [price, setPrice] = useState('')
  const [minDays, setMinDays] = useState('')
  const [maxDays, setMaxDays] = useState('')
  const [activeFrom, setActiveFrom] = useState('')
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const lock = useRef(false)
  const captcha = useRef(null)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)
  const selected = catalog.find((item) => item.code === code)
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    const request = tab === 'catalog' ? getCommercialCatalog() : listCommercial(tab, code, cursor)
    request
      .then((data) => {
        if (current) {
          if (tab === 'catalog') setCatalog(data.items)
          else setPage(data)
        }
      })
      .catch((e) => {
        if (current) setError(commercialError(e))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [tab, code, cursor, revision])
  function chooseTab(value) {
    setTab(value)
    setCursor(null)
    setPage({ items: [], nextCursor: null })
  }
  function openAction(kind, item) {
    setAction({ kind, item, requestId: crypto.randomUUID() })
    setPrice(item.currentPrice?.unitPriceCash || '')
    setMinDays(item.currentPrice?.minDays || '')
    setMaxDays(item.currentPrice?.maxDays || '')
    setActiveFrom('')
    setReason('')
    setPassword('')
    setConfirmed(false)
    setError('')
  }
  async function save() {
    if (lock.current || !confirmed) return
    lock.current = true
    setSaving(true)
    setError('')
    try {
      await reauthenticatePricingAdmin(password, takeCaptchaToken(captcha))
      const values = {
        ...action.item,
        code: action.item.code,
        revision: action.item.revision,
        requestId: action.requestId,
        reason,
        confirm: confirmed,
      }
      if (action.kind === 'price')
        await publishCommercialPrice({
          ...values,
          price,
          minDays,
          maxDays,
          activeFrom: activeFrom ? new Date(activeFrom).toISOString() : null,
        })
      else if (action.kind === 'sales')
        await setCommercialSales({ ...values, enabled: !action.item.salesEnabled })
      else if (action.kind === 'refund') await reverseCommercialOrder(values)
      else await setCommercialEntitlement({ ...values, state: action.kind })
      setAction(null)
      setCursor(null)
      setRevision((v) => v + 1)
    } catch (e) {
      setError(commercialError(e))
    } finally {
      captcha.current?.reset()
      setPassword('')
      lock.current = false
      setSaving(false)
    }
  }
  const changeInvalid = action?.kind === 'price' && !validCommercialPrice(price, minDays, maxDays)
  return (
    <Box sx={{ minWidth: 0 }}>
      <Heading as="h2" sx={{ fontSize: 3, mb: 2 }}>
        Preços e contratações
      </Heading>
      <Text as="p" sx={{ color: 'fg.muted' }}>
        Preços em EvoCash independentes do valor de aquisição em reais. Pausar novas vendas preserva
        os direitos contratados.
      </Text>
      {import.meta.env.DEV && import.meta.env.VITE_FINANCE_LOCAL_PREVIEW === 'true' && (
        <Flash sx={{ mb: 3 }}>
          Stack local isolada · dados e saldos sintéticos · nenhuma cobrança real.
        </Flash>
      )}
      <Box
        role="group"
        aria-label="Seções do motor comercial"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}
      >
        {Object.entries(tabs).map(([key, label]) => (
          <Button
            key={key}
            aria-pressed={tab === key}
            variant={tab === key ? 'primary' : 'default'}
            onClick={() => chooseTab(key)}
          >
            {label}
          </Button>
        ))}
      </Box>
      {tab !== 'catalog' && (
        <FormControl sx={{ mb: 3 }}>
          <FormControl.Label>Serviço</FormControl.Label>
          <Select
            block
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              setCursor(null)
            }}
          >
            <Select.Option value="">
              {tab === 'prices' ? 'Selecione um serviço' : 'Todos os serviços'}
            </Select.Option>
            {catalog.map((item) => (
              <Select.Option key={item.code} value={item.code}>
                {item.name}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
      )}
      {error && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}
      <Button onClick={() => setRevision((v) => v + 1)} disabled={loading} sx={{ mb: 3 }}>
        Atualizar dados
      </Button>
      {loading ? (
        <Spinner aria-label="Carregando motor comercial" />
      ) : tab === 'catalog' ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: ['1fr', '1fr', 'repeat(2,minmax(0,1fr))'],
            gap: 3,
          }}
        >
          {catalog.map((item) => (
            <Box
              key={item.code}
              sx={{
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'border.default',
                borderRadius: 2,
                p: 3,
              }}
            >
              <Heading as="h3" sx={{ fontSize: 2 }}>
                {item.name}
              </Heading>
              <Text as="p">{item.description}</Text>
              <Label>{item.salesEnabled ? 'Novas vendas ativas' : 'Novas vendas pausadas'}</Label>
              <Text as="p">
                {item.currentPrice
                  ? `${item.currentPrice.unitPriceCash} EvoCash/dia · ${item.currentPrice.minDays} a ${item.currentPrice.maxDays} dias`
                  : 'Sem preço publicado'}
              </Text>
              {!item.integrationReady && (
                <Text as="p" sx={{ color: 'fg.muted' }}>
                  Integração editorial prevista para uma próxima fase. Vendas indisponíveis.
                </Text>
              )}
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Button onClick={() => openAction('price', item)}>Configurar preço</Button>
                <Button
                  disabled={!item.salesEnabled && (!item.integrationReady || !item.currentPrice)}
                  onClick={() => openAction('sales', item)}
                >
                  {item.salesEnabled ? 'Pausar vendas' : 'Ativar vendas'}
                </Button>
                <Button
                  onClick={() => {
                    setCode(item.code)
                    chooseTab('prices')
                  }}
                >
                  Histórico de preços
                </Button>
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <>
          {page.items.length === 0 && (
            <Text as="p">
              Nenhum registro encontrado{selected ? ` para ${selected.name}` : ''}.
            </Text>
          )}
          {page.items.map((item) => (
            <Box
              key={item.cursor}
              sx={{
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'border.default',
                borderRadius: 2,
                p: 3,
                mb: 3,
                overflowWrap: 'anywhere',
              }}
            >
              {tab === 'prices' && (
                <>
                  <Heading as="h3" sx={{ fontSize: 2 }}>
                    Versão {item.cursor} · {item.unit_price_cash} EvoCash/dia
                  </Heading>
                  <Text as="p">
                    De {item.min_days} a {item.max_days} dias · vigência{' '}
                    {commercialDate(item.active_from)}
                  </Text>
                  <Text as="p">{item.reason}</Text>
                  <Text as="p">Autor: {item.created_by}</Text>
                </>
              )}
              {tab === 'orders' && (
                <>
                  <Label>{stateLabels[item.status] || item.status}</Label>
                  <Text as="p">
                    {item.offeringCode} · {item.durationDays} dias · {item.totalCash} EvoCash
                  </Text>
                  <Text as="p">Pedido: {item.id}</Text>
                  <Text as="p">Recurso: {item.resourceId}</Text>
                  <Text as="p">
                    {commercialDate(item.periodStart)} → {commercialDate(item.periodEnd)}
                  </Text>
                  {item.status === 'fulfilled' && (
                    <Button variant="danger" onClick={() => openAction('refund', item)}>
                      Reverter contratação
                    </Button>
                  )}
                </>
              )}
              {tab === 'rights' && (
                <>
                  <Label>{stateLabels[item.effectiveState] || item.effectiveState}</Label>
                  <Text as="p">
                    {item.offeringCode} · recurso {item.resourceId}
                  </Text>
                  <Text as="p">Direito: {item.id}</Text>
                  <Text as="p">
                    {commercialDate(item.startsAt)} → {commercialDate(item.expiresAt)}
                  </Text>
                  {item.administrativeState !== 'revoked' && (
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      <Button
                        onClick={() =>
                          openAction(
                            item.administrativeState === 'suspended' ? 'enabled' : 'suspended',
                            item
                          )
                        }
                      >
                        {item.administrativeState === 'suspended'
                          ? 'Retomar direito'
                          : 'Suspender direito'}
                      </Button>
                      <Button variant="danger" onClick={() => openAction('revoked', item)}>
                        Revogar direito
                      </Button>
                    </Box>
                  )}
                </>
              )}
              {tab === 'events' && (
                <>
                  <Heading as="h3" sx={{ fontSize: 2 }}>
                    Evento #{item.cursor} · {item.action}
                  </Heading>
                  <Text as="p">
                    {commercialDate(item.occurred_at)} · ator {item.actor_user_id}
                  </Text>
                  <Text as="p">{item.reason}</Text>
                  {item.order_id && <Text as="p">Pedido: {item.order_id}</Text>}
                  <details>
                    <summary>Dados auditáveis</summary>
                    <Box as="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 1 }}>
                      {JSON.stringify(item.payload, null, 2)}
                    </Box>
                  </details>
                </>
              )}
            </Box>
          ))}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button disabled={!cursor || loading} onClick={() => setCursor(null)}>
              Primeira página
            </Button>
            <Button
              disabled={!page.nextCursor || loading}
              onClick={() => setCursor(page.nextCursor)}
            >
              Próxima página
            </Button>
          </Box>
        </>
      )}
      {import.meta.env.DEV && import.meta.env.VITE_FINANCE_LOCAL_PREVIEW === 'true' && (
        <Suspense fallback={<Spinner />}>
          <LocalContractPreview />
        </Suspense>
      )}
      {action && (
        <Dialog
          title="Confirmar alteração comercial"
          onClose={() => {
            if (!saving) {
              setPassword('')
              setAction(null)
            }
          }}
          width="large"
        >
          {action && (
            <Box sx={{ p: 3 }}>
              <Text as="p">
                {action.kind === 'price'
                  ? `Publicar preço de ${action.item.name}`
                  : action.kind === 'sales'
                    ? `${action.item.salesEnabled ? 'Pausar' : 'Ativar'} novas vendas de ${action.item.name}`
                    : action.kind === 'refund'
                      ? `Devolver ${action.item.totalCash} EvoCash e remover o período desta contratação`
                      : `Alterar direito: ${action.kind}`}
              </Text>
              {action.kind === 'price' && (
                <>
                  <FormControl disabled={saving}>
                    <FormControl.Label>EvoCash por dia</FormControl.Label>
                    <TextInput
                      block
                      inputMode="numeric"
                      value={price}
                      onChange={(e) => {
                        setPrice(e.target.value)
                        setConfirmed(false)
                      }}
                    />
                  </FormControl>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, my: 2 }}>
                    <FormControl disabled={saving}>
                      <FormControl.Label>Mínimo de dias</FormControl.Label>
                      <TextInput
                        block
                        inputMode="numeric"
                        value={minDays}
                        onChange={(e) => {
                          setMinDays(e.target.value)
                          setConfirmed(false)
                        }}
                      />
                    </FormControl>
                    <FormControl disabled={saving}>
                      <FormControl.Label>Máximo de dias</FormControl.Label>
                      <TextInput
                        block
                        inputMode="numeric"
                        value={maxDays}
                        onChange={(e) => {
                          setMaxDays(e.target.value)
                          setConfirmed(false)
                        }}
                      />
                    </FormControl>
                  </Box>
                  <FormControl disabled={saving}>
                    <FormControl.Label>Vigência agendada (opcional)</FormControl.Label>
                    <TextInput
                      block
                      type="datetime-local"
                      value={activeFrom}
                      onChange={(e) => {
                        setActiveFrom(e.target.value)
                        setConfirmed(false)
                      }}
                    />
                    <FormControl.Caption>
                      Horário do dispositivo; será registrado em UTC. Em branco: imediato.
                    </FormControl.Caption>
                  </FormControl>
                </>
              )}
              <FormControl disabled={saving} sx={{ my: 3 }}>
                <FormControl.Label>Justificativa obrigatória</FormControl.Label>
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
              <FormControl disabled={saving}>
                <FormControl.Label>Confirme sua senha</FormControl.Label>
                <TextInput
                  block
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FormControl>
              <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />
              <FormControl disabled={saving} sx={{ my: 3 }}>
                <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <FormControl.Label>
                  Revisei os valores e autorizo esta operação auditada
                </FormControl.Label>
              </FormControl>
              {error && (
                <Flash variant="danger" sx={{ mb: 3 }}>
                  {error}
                </Flash>
              )}
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button disabled={saving} onClick={() => setAction(null)}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  disabled={
                    saving || !confirmed || !password || !captchaVerified || reason.trim().length < 5 || changeInvalid
                  }
                  onClick={save}
                >
                  {saving ? 'Confirmando…' : 'Confirmar alteração'}
                </Button>
              </Box>
            </Box>
          )}
        </Dialog>
      )}
    </Box>
  )
}

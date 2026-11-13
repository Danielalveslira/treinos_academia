import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
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
import {
  getEvoCashPricing,
  listEvoCashPrices,
  pauseEvoCashQuotes,
  previewEvoCashPrice,
  publishEvoCashPrice,
  reauthenticatePricingAdmin,
} from '../services/evocashPricingService'
import {
  PRICE_FIELDS,
  formatPriceBRL,
  formatPriceChange,
  priceConfig,
  priceDate,
  priceForm,
  pricingError,
} from '../utils/evocashPricing'
import { AuthCaptcha } from './AuthCaptcha'
import { authCaptchaRequired, takeCaptchaToken } from '../utils/authCaptcha'

function PriceSummary({ version, title }) {
  return (
    <Box
      sx={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
      }}
    >
      <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
        {title}
      </Heading>
      {version ? (
        <>
          <Text as="p" sx={{ fontSize: 3, fontWeight: 'bold', m: 0 }}>
            {formatPriceBRL(version.unitPriceCentavos)} por EvoCash
          </Text>
          <Text as="p" sx={{ mb: 0 }}>
            Vigência: {priceDate(version.activeFrom)}
          </Text>
          <Text as="p" sx={{ mb: 0 }}>
            De {version.minQuantity} a {version.maxQuantity} EvoCash por compra.
          </Text>
        </>
      ) : (
        <Text as="p" sx={{ m: 0 }}>
          Nenhum preço publicado. Defina os valores e simule antes de confirmar.
        </Text>
      )}
    </Box>
  )
}

function PriceConfirmation({ action, state, preview, config, activeFrom, onClose, onSaved }) {
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [largeChange, setLargeChange] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Same request ID and payload survive ambiguous errors/retries within this dialog.
  const operation = useRef(null)
  const captcha = useRef(null)
  const [captchaVerified, setCaptchaVerified] = useState(!authCaptchaRequired)
  const publishing = action === 'publish'
  const valid =
    reason.trim().length >= 5 &&
    password.length > 0 &&
    confirmed &&
    captchaVerified &&
    (!preview?.requiresAdditionalConfirmation || largeChange)
  async function save() {
    if (busy || !valid) return
    setBusy(true)
    setError('')
    try {
      const body = {
        config,
        activeFrom,
        revision: state.revision,
        reason: reason.trim(),
        confirmLargeChange: largeChange,
      }
      const signature = JSON.stringify(body)
      if (!operation.current || operation.current.signature !== signature)
        operation.current = { signature, requestId: crypto.randomUUID() }
      await reauthenticatePricingAdmin(password, takeCaptchaToken(captcha))
      setPassword('')
      if (publishing) await publishEvoCashPrice({ ...body, requestId: operation.current.requestId })
      else await pauseEvoCashQuotes({ ...body, requestId: operation.current.requestId })
      await onSaved(
        publishing
          ? 'Novo preço publicado. A disponibilidade das compras permanece inalterada.'
          : 'Novas cotações pausadas.'
      )
    } catch (err) {
      setPassword('')
      setError(pricingError(err))
    } finally {
      captcha.current?.reset()
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={publishing ? 'Confirmar novo preço' : 'Pausar novas cotações'}
      onClose={busy ? () => {} : onClose}
      footerButtons={[
        { content: 'Voltar', onClick: onClose, disabled: busy },
        {
          content: busy ? 'Confirmando…' : publishing ? 'Confirmar publicação' : 'Confirmar pausa',
          buttonType: publishing ? 'primary' : 'danger',
          onClick: save,
          disabled: busy || !valid,
        },
      ]}
    >
      <Box sx={{ p: 3, display: 'grid', gap: 3 }}>
        {error && (
          <Flash variant="danger" role="alert">
            {error}
          </Flash>
        )}
        <Text as="p" sx={{ m: 0 }}>
          {publishing
            ? `Novo preço: ${formatPriceBRL(config.unitPriceCentavos)} por EvoCash. ${activeFrom ? `Início: ${priceDate(activeFrom)}.` : 'Vigência imediata após confirmação do servidor.'}`
            : 'Impede novas cotações. Pedidos já formalizados permanecem com os valores aceitos.'}
        </Text>
        <FormControl required>
          <FormControl.Label>Justificativa</FormControl.Label>
          <Textarea
            block
            maxLength={500}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
          <FormControl.Caption>
            De 5 a 500 caracteres; ficará no histórico de auditoria.
          </FormControl.Caption>
        </FormControl>
        <FormControl required>
          <FormControl.Label>Confirme sua senha</FormControl.Label>
          <TextInput
            block
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </FormControl>
        <AuthCaptcha ref={captcha} onVerifiedChange={setCaptchaVerified} />
        <FormControl>
          <Checkbox
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={busy}
          />
          <FormControl.Label>
            {publishing
              ? 'Confirmo os valores e a vigência. Saldos e pedidos existentes permanecem preservados.'
              : 'Confirmo a pausa de novas cotações.'}
          </FormControl.Label>
        </FormControl>
        {preview?.requiresAdditionalConfirmation && (
          <FormControl>
            <Checkbox
              checked={largeChange}
              onChange={(e) => setLargeChange(e.target.checked)}
              disabled={busy}
            />
            <FormControl.Label>
              Reconheço que a alteração ultrapassa o limiar de impacto da versão anterior.
            </FormControl.Label>
          </FormControl>
        )}
      </Box>
    </Dialog>
  )
}

export function EvoCashPricingPanel() {
  const [state, setState] = useState(null)
  const [form, setForm] = useState(() => priceForm())
  const [quantityText, setQuantityText] = useState('')
  const [start, setStart] = useState('')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [simulating, setSimulating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState(null)
  const generation = useRef(0)
  const mounted = useRef(false)
  useEffect(() => {
    let active = true
    mounted.current = true
    getEvoCashPricing()
      .then((result) => {
        if (active) {
          setState(result)
          setForm(priceForm(result.latest))
        }
      })
      .catch((err) => {
        if (active) setError(pricingError(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      mounted.current = false
    }
  }, [])
  async function reload() {
    setLoading(true)
    setError('')
    setPreview(null)
    generation.current++
    try {
      const result = await getEvoCashPricing()
      if (mounted.current) {
        setState(result)
        setForm(priceForm(result.latest))
      }
    } catch (err) {
      if (mounted.current) setError(pricingError(err))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }
  function invalidate() {
    generation.current++
    setPreview(null)
    setNotice('')
  }
  async function simulate(event) {
    event.preventDefault()
    if (simulating || !state) return
    setError('')
    setNotice('')
    setSimulating(true)
    setPreview(null)
    const currentGeneration = ++generation.current
    try {
      const config = priceConfig(form)
      const quantities = quantityText.trim()
        ? quantityText.split(';').map((v) => v.trim())
        : [...new Set([config.minQuantity, config.maxQuantity])]
      const activeFrom = start ? new Date(start).toISOString() : null
      const result = await previewEvoCashPrice(config, quantities, state.revision)
      if (mounted.current && generation.current === currentGeneration)
        setPreview({ ...result, config, activeFrom })
    } catch (err) {
      if (mounted.current && generation.current === currentGeneration) setError(pricingError(err))
    } finally {
      if (mounted.current) setSimulating(false)
    }
  }
  async function saved(message) {
    setDialog(null)
    setNotice(message)
    await reload()
  }
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      {import.meta.env.DEV && import.meta.env.VITE_FINANCE_LOCAL_PREVIEW === 'true' && (
        <Flash>
          Ambiente local de testes. Os dados exibidos são fictícios e nenhum pagamento real é
          realizado.
        </Flash>
      )}
      {notice && (
        <Flash variant="success" role="status">
          {notice}
        </Flash>
      )}
      {error && (
        <Flash variant="danger" role="alert">
          {error}{' '}
          <Button onClick={reload} disabled={loading}>
            Atualizar dados
          </Button>
        </Flash>
      )}
      {loading && <Spinner aria-label="Carregando precificação" />}
      {!loading && state && (
        <>
          {/* Estado real do servidor, não um texto fixo: cotação (vitrine de preço) e
              checkout (pagamento de verdade) são guardas independentes -- ver
              require_evocash_admin + checkout_enabled em evocash_pricing_state. */}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Label variant={state.quotingEnabled ? 'success' : 'secondary'}>
              {state.quotingEnabled ? 'Cotações habilitadas' : 'Cotações pausadas'}
            </Label>
            <Label variant={state.checkoutEnabled ? 'success' : 'secondary'}>
              {state.checkoutEnabled ? 'Checkout habilitado' : 'Checkout pausado'}
            </Label>
            <Button onClick={reload}>Atualizar dados</Button>
            {state.quotingEnabled && (
              <Button variant="danger" onClick={() => setDialog('pause')}>
                Pausar novas cotações
              </Button>
            )}
          </Box>
          {!state.checkoutEnabled && (
            <Flash variant="attention">
              Checkout de compra está pausado -- publicar ou simular um preço aqui não abre
              pagamento nem altera saldos enquanto isso.
            </Flash>
          )}
          <PriceSummary version={state.current} title="Preço vigente" />
          {state.latest && state.latest.id !== state.current?.id && (
            <PriceSummary version={state.latest} title="Último preço programado" />
          )}
          <Box as="form" onSubmit={simulate} sx={{ display: 'grid', gap: 3 }}>
            <Heading as="h2" sx={{ fontSize: 2 }}>
              Preparar novo preço
            </Heading>
            <Text as="p" sx={{ m: 0 }}>
              Preencha os valores comerciais aprovados. A simulação é calculada no servidor.
            </Text>
            <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: ['1fr', '1fr', '1fr 1fr'] }}>
              {PRICE_FIELDS.map(([key, label, type]) => (
                <FormControl key={key} required>
                  <FormControl.Label>{label}</FormControl.Label>
                  <TextInput
                    block
                    inputMode={type === 'money' ? 'decimal' : 'numeric'}
                    value={form[key]}
                    maxLength={14}
                    onChange={(e) => {
                      invalidate()
                      setForm((previous) => ({ ...previous, [key]: e.target.value }))
                    }}
                  />
                  {key === 'largeChangeThresholdBps' && (
                    <FormControl.Caption>
                      100 pontos-base = 1%. Exige confirmação adicional ao atingir esse limiar.
                    </FormControl.Caption>
                  )}
                  {key === 'quoteTtlSeconds' && (
                    <FormControl.Caption>De 30 a 3.600 segundos.</FormControl.Caption>
                  )}
                </FormControl>
              ))}
            </Box>
            <FormControl>
              <FormControl.Label>Data e hora de início (horário do dispositivo)</FormControl.Label>
              <TextInput
                block
                type="datetime-local"
                value={start}
                onChange={(e) => {
                  invalidate()
                  setStart(e.target.value)
                }}
              />
              <FormControl.Caption>
                Deixe vazio para vigência imediata. A confirmação mostra o horário de Brasília.
              </FormControl.Caption>
            </FormControl>
            <FormControl>
              <FormControl.Label>Quantidades para simulação</FormControl.Label>
              <TextInput
                block
                inputMode="text"
                value={quantityText}
                onChange={(e) => {
                  invalidate()
                  setQuantityText(e.target.value)
                }}
                placeholder="Separe por ponto e vírgula"
              />
              <FormControl.Caption>
                Vazio: simula o mínimo e o máximo informados. Até dez quantidades.
              </FormControl.Caption>
            </FormControl>
            <Box>
              <Button type="submit" disabled={simulating}>
                {simulating ? 'Simulando…' : 'Simular preço'}
              </Button>
            </Box>
          </Box>
          {preview && (
            <Box
              sx={{
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'border.default',
                borderRadius: 2,
                p: 3,
              }}
            >
              <Heading as="h2" sx={{ fontSize: 2 }}>
                Simulação
              </Heading>
              <Text as="p">
                Preço anterior: {formatPriceBRL(preview.previousUnitPriceCentavos)} · Novo preço:{' '}
                {formatPriceBRL(preview.config.unitPriceCentavos)}
              </Text>
              {preview.changeBps !== null && (
                <Text as="p">Variação: {formatPriceChange(preview.changeBps)}.</Text>
              )}
              {preview.samples.map((sample) => (
                <Text as="p" key={sample.quantity}>
                  {sample.quantity} EvoCash → {formatPriceBRL(sample.totalCentavos)}
                </Text>
              ))}
              <Button variant="primary" onClick={() => setDialog('publish')}>
                Publicar novo preço
              </Button>
            </Box>
          )}
        </>
      )}
      {dialog && (
        <PriceConfirmation
          action={dialog}
          state={state}
          preview={dialog === 'publish' ? preview : null}
          config={preview?.config}
          activeFrom={preview?.activeFrom ?? null}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
    </Box>
  )
}

export function EvoCashPriceHistory() {
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const active = useRef(false)
  const busy = useRef(false)
  const lastCursor = useRef(null)
  useEffect(() => {
    active.current = true
    let current = true
    listEvoCashPrices()
      .then((page) => {
        if (current) {
          setItems(page.items)
          setCursor(page.nextCursor)
        }
      })
      .catch((err) => {
        if (current) setError(pricingError(err))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
      active.current = false
    }
  }, [])
  async function loadMore() {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setError('')
    try {
      const page = await listEvoCashPrices(lastCursor.current)
      if (!active.current) return
      setItems((previous) => [
        ...previous,
        ...page.items.filter((item) => !previous.some((old) => old.id === item.id)),
      ])
      setCursor(page.nextCursor)
    } catch (err) {
      if (active.current) setError(pricingError(err))
    } finally {
      busy.current = false
      if (active.current) setLoading(false)
    }
  }
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Text as="p" sx={{ m: 0 }}>
        Versões publicadas, incluindo preços programados. Cada alteração mantém autor, justificativa
        e vigência.
      </Text>
      {error && (
        <Flash variant="danger" role="alert">
          {error}{' '}
          <Button onClick={loadMore} disabled={loading}>
            Tentar novamente
          </Button>
        </Flash>
      )}
      {loading && <Spinner aria-label="Carregando histórico de preços" />}
      {!loading && !error && items.length === 0 && <Text as="p">Nenhum preço publicado.</Text>}
      {items.length > 0 && (
        <Box
          role="region"
          aria-label="Tabela de histórico de preços"
          tabIndex={0}
          sx={{ overflowX: 'auto' }}
        >
          <Box
            as="table"
            sx={{
              width: '100%',
              minWidth: '640px',
              borderCollapse: 'collapse',
              textAlign: 'left',
              '& th, & td': {
                p: 3,
                borderBottom: '1px solid',
                borderColor: 'border.default',
                verticalAlign: 'top',
              },
              '& th': { fontSize: 1, color: 'fg.muted' },
            }}
          >
            <caption>Histórico imutável de preços do EvoCash</caption>
            <thead>
              <tr>
                <th scope="col">Preço e versão</th>
                <th scope="col">Vigência</th>
                <th scope="col">Autor e justificativa</th>
                <th scope="col">Limites</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Text sx={{ fontWeight: 'bold' }}>
                      {formatPriceBRL(item.unitPriceCentavos)}
                    </Text>
                    <br />
                    Versão {item.revision}
                  </td>
                  <td>
                    {priceDate(item.activeFrom)}
                    <br />
                    <Text sx={{ fontSize: 0 }}>Publicado em {priceDate(item.createdAt)}</Text>
                  </td>
                  <td>
                    <Text as="p" sx={{ m: 0, overflowWrap: 'anywhere' }}>
                      {item.createdBy}
                    </Text>
                    <Text as="p" sx={{ mb: 0 }}>
                      {item.reason}
                    </Text>
                  </td>
                  <td>
                    De {item.minQuantity} a {item.maxQuantity} EvoCash por compra.
                    <br />
                    Diário/total: {item.dailyQuantityLimit}/{item.totalQuantityLimit}.<br />
                    Cotação: {item.quoteTtlSeconds}s.
                  </td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      )}
      {cursor && (
        <Box>
          <Button
            disabled={loading}
            onClick={() => {
              lastCursor.current = cursor
              loadMore()
            }}
          >
            Carregar mais preços
          </Button>
        </Box>
      )}
    </Box>
  )
}

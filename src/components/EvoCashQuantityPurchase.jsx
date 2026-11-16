import { useEffect, useRef, useState } from 'react'
import { Box, Button, Flash, FormControl, Heading, Spinner, Text, TextInput } from '@primer/react'
import { getCashPurchaseSettings, requestCashPurchase } from '../services/cashPurchaseService'
import { acceptCommercialTerms } from '../services/commercialService'
import { CommercialTermsAcceptance } from './CommercialTermsAcceptance'
import { commercialTermsState } from '../utils/commercialTerms'
import { createEvoCashQuote } from '../services/evocashPricingService'
import { formatPriceBRL, priceDate } from '../utils/evocashPricing'
import { openInfinitepayCheckout } from '../utils/cashPurchaseFlow'
import { checkoutRequestId, purchaseError } from '../utils/quantityPurchase'

export function EvoCashQuantityPurchase({ userId, hasPendingPurchase, onPurchaseChanged }) {
  const [settings, setSettings] = useState(null)
  const [quantity, setQuantity] = useState('')
  const [quote, setQuote] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const [checkoutUncertain, setCheckoutUncertain] = useState(false)
  const generation = useRef(0)
  const mounted = useRef(false)
  const locked = useRef(false)
  const intent = useRef(null)
  useEffect(() => {
    let active = true
    mounted.current = true
    getCashPurchaseSettings()
      .then((data) => {
        if (active) setSettings(data)
      })
      .catch((err) => {
        if (active) setError(purchaseError(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      mounted.current = false
    }
  }, [userId])
  useEffect(() => {
    if (!quote) return
    const timer = setTimeout(
      () => {
        setExpired(true)
        setConfirmed(false)
      },
      Math.max(0, quote.deadline - performance.now())
    )
    return () => clearTimeout(timer)
  }, [quote])
  useEffect(() => {
    if (checkoutUncertain && !hasPendingPurchase) setCheckoutUncertain(false)
  }, [checkoutUncertain, hasPendingPurchase])
  const validInteger = /^[1-9][0-9]{0,6}$/.test(quantity)
  const valid =
    validInteger &&
    settings?.minQuantity &&
    BigInt(quantity) >= BigInt(settings.minQuantity) &&
    BigInt(quantity) <= BigInt(settings.maxQuantity)
  const estimate =
    valid && settings?.unitPriceCentavos
      ? (BigInt(quantity) * BigInt(settings.unitPriceCentavos)).toString()
      : null
  function change(value) {
    generation.current++
    intent.current = null
    setQuantity(value)
    setQuote(null)
    setConfirmed(false)
    setExpired(false)
    setError('')
  }
  const shortcuts = [10, 25, 50, 100, 250].filter(
    (value) =>
      settings && value >= Number(settings.minQuantity) && value <= Number(settings.maxQuantity)
  )
  async function review(event) {
    event.preventDefault()
    if (locked.current || !valid || !settings?.enabled || hasPendingPurchase || checkoutUncertain)
      return
    locked.current = true
    setBusy(true)
    setError('')
    setConfirmed(false)
    setQuote(null)
    setExpired(false)
    const current = ++generation.current
    const started = performance.now()
    if (!intent.current) intent.current = crypto.randomUUID()
    try {
      const data = await createEvoCashQuote(quantity, intent.current)
      if (mounted.current && current === generation.current) {
        const ttl = Date.parse(data.expiresAt) - Date.parse(data.createdAt)
        setQuote({ ...data, deadline: started + ttl })
      }
    } catch (err) {
      if (mounted.current && current === generation.current) {
        setError(purchaseError(err))
        intent.current = null
      }
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function checkout() {
    if (locked.current || !confirmed || !quote || hasPendingPurchase || checkoutUncertain) return
    if (commercialTermsState(quote.terms) !== 'ready') return
    if (performance.now() >= quote.deadline) {
      setExpired(true)
      setConfirmed(false)
      return
    }
    locked.current = true
    setBusy(true)
    setError('')
    let checkoutRequested = false
    try {
      // Aceite das Condições do EvoCash vinculado a esta cotação (idempotente). O servidor
      // recusa reservar o checkout sem ele.
      await acceptCommercialTerms('evocash_quote', quote.quoteId, quote.terms)
      const requestId = checkoutRequestId(userId, quote.quoteId)
      checkoutRequested = true
      const result = await requestCashPurchase({ quoteId: quote.quoteId, requestId })
      openInfinitepayCheckout(result.checkoutUrl)
    } catch (err) {
      if (mounted.current) {
        setError(purchaseError(err))
        if (err.message === 'QUOTE_EXPIRED') {
          setExpired(true)
          setConfirmed(false)
        }
        if (checkoutRequested) {
          setCheckoutUncertain(true)
          // A resposta pode ter falhado depois de reservar um pedido.
          await onPurchaseChanged()
        }
      }
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <Box
      className="evocash-purchase-card"
      sx={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: [3, 4],
        display: 'grid',
        gap: 3,
      }}
    >
      <Heading as="h2" sx={{ fontSize: 2 }}>
        {quote ? 'Revise sua compra' : 'Quantos EvoCash deseja?'}
      </Heading>
      {import.meta.env.DEV && import.meta.env.VITE_FINANCE_LOCAL_PREVIEW === 'true' && (
        <Flash>Ambiente de demonstração. Pagamentos simulados, sem cobrança real.</Flash>
      )}
      {error && (
        <Flash variant="danger" role="alert">
          {error}
        </Flash>
      )}
      {checkoutUncertain && (
        <Flash variant="attention" role="status">
          O pedido pode estar sendo preparado ou conciliado. Confira o Histórico antes de tentar
          comprar novamente.
        </Flash>
      )}
      {loading && <Spinner aria-label="Carregando preço do EvoCash" />}
      {!loading && !settings && (
        <Text as="p">O preço está indisponível. Atualize a página para tentar novamente.</Text>
      )}
      {settings && !settings.priceVersionId && (
        <Text as="p">Nenhum preço está disponível para novas compras.</Text>
      )}
      {settings?.priceVersionId && !settings.enabled && (
        <Flash variant="attention">A compra de EvoCash está temporariamente pausada.</Flash>
      )}
      {settings?.priceVersionId && settings.enabled && (
        <>
          {hasPendingPurchase && (
            <Flash variant="attention">
              Você já tem uma compra em andamento. Acompanhe no Histórico.
            </Flash>
          )}
          {!quote && (
            <Box as="form" onSubmit={review} sx={{ display: 'grid', gap: 3 }}>
              {shortcuts.length > 0 && (
                <Box
                  sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}
                  aria-label="Quantidades sugeridas"
                >
                  {shortcuts.map((value) => (
                    <Button
                      key={value}
                      type="button"
                      onClick={() => change(String(value))}
                      disabled={busy || hasPendingPurchase || checkoutUncertain}
                    >
                      {value}
                    </Button>
                  ))}
                </Box>
              )}
              <FormControl required disabled={busy || hasPendingPurchase || checkoutUncertain}>
                <FormControl.Label>Quantidade de EvoCash</FormControl.Label>
                <TextInput
                  block
                  inputMode="numeric"
                  autoComplete="off"
                  value={quantity}
                  maxLength={7}
                  onChange={(e) => change(e.target.value)}
                  aria-describedby="quantity-limits"
                />
                <FormControl.Caption id="quantity-limits">
                  De {settings.minQuantity} a {settings.maxQuantity} EvoCash por compra. Use apenas
                  números inteiros.
                </FormControl.Caption>
                {quantity && !valid && (
                  <FormControl.Validation variant="error">
                    Informe uma quantidade inteira dentro desse intervalo.
                  </FormControl.Validation>
                )}
              </FormControl>
              <Box aria-live="polite">
                <Text as="p" sx={{ m: 0, color: 'fg.muted' }}>
                  Total estimado
                </Text>
                <Text as="p" sx={{ m: 0, fontSize: 4, fontWeight: 'bold' }}>
                  {estimate ? formatPriceBRL(estimate) : '—'}
                </Text>
                <Text as="p" sx={{ mt: 1, mb: 0, fontSize: 0, color: 'fg.muted' }}>
                  1 EvoCash = {formatPriceBRL(settings.unitPriceCentavos)}. O valor final será
                  confirmado na revisão.
                </Text>
              </Box>
              <details>
                <summary>Limites de compra</summary>
                <Text as="p" sx={{ mb: 0 }}>
                  Limite diário: {settings.dailyQuantityLimit} EvoCash (dia UTC). Limite total:{' '}
                  {settings.totalQuantityLimit} EvoCash. Compras em andamento também podem reservar
                  esses limites.
                </Text>
              </details>
              <Box className="evocash-single-action">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!valid || busy || hasPendingPurchase || checkoutUncertain}
                >
                  {busy ? 'Consultando…' : 'Revisar compra'}
                </Button>
              </Box>
            </Box>
          )}
          {quote && (
            <Box
              sx={{
                borderTopWidth: 1,
                borderTopStyle: 'solid',
                borderColor: 'border.default',
                pt: 3,
                display: 'grid',
                gap: 3,
              }}
            >
              <Text as="p" sx={{ m: 0, fontSize: 4, fontWeight: 'bold' }}>
                {formatPriceBRL(quote.totalCentavos)}
              </Text>
              {expired && (
                <Flash variant="attention" role="status">
                  Esta cotação expirou. Gere uma nova para continuar.
                </Flash>
              )}
              <CommercialTermsAcceptance
                terms={quote.terms}
                checked={confirmed}
                onChange={setConfirmed}
                disabled={expired || busy || hasPendingPurchase}
                summary={[
                  ['Quantidade', `${quote.quantity} EvoCash`],
                  ['Preço unitário', formatPriceBRL(quote.unitPriceCentavos)],
                  [
                    'Uso',
                    'Créditos para contratar serviços dentro do Evolutus, sem saque nem rendimento',
                  ],
                  ['Liberação', 'Somente após a confirmação do pagamento pela InfinitePay'],
                  ['Cotação válida até', priceDate(quote.expiresAt)],
                ]}
              />
              <Text as="p" sx={{ m: 0, fontSize: 0, color: 'fg.muted' }}>
                O pagamento acontece na InfinitePay, com as opções disponíveis no checkout. O
                EvoCash será liberado somente após a confirmação do pagamento. Não há renovação
                automática.
              </Text>
              <Box className="evocash-actions">
                <Button type="button" onClick={() => change(quantity)} disabled={busy}>
                  Voltar e editar
                </Button>
                {expired || commercialTermsState(quote.terms) === 'changed' ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={review}
                    disabled={busy || hasPendingPurchase || checkoutUncertain}
                  >
                    {busy ? 'Consultando…' : 'Gerar nova cotação'}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={checkout}
                    disabled={
                      !confirmed ||
                      expired ||
                      busy ||
                      hasPendingPurchase ||
                      checkoutUncertain ||
                      commercialTermsState(quote.terms) !== 'ready'
                    }
                  >
                    {busy ? 'Preparando pagamento…' : 'Ir para pagamento seguro'}
                  </Button>
                )}
              </Box>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

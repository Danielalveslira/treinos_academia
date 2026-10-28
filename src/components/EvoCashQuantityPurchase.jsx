import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Flash,
  FormControl,
  Heading,
  Spinner,
  Text,
  TextInput,
} from '@primer/react'
import { getCashPurchaseSettings, requestCashPurchase } from '../services/cashPurchaseService'
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
  async function review(event) {
    event.preventDefault()
    if (locked.current || !valid || !settings?.enabled || hasPendingPurchase) return
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
    if (locked.current || !confirmed || !quote || hasPendingPurchase) return
    if (performance.now() >= quote.deadline) {
      setExpired(true)
      setConfirmed(false)
      return
    }
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const requestId = checkoutRequestId(userId, quote.quoteId)
      const result = await requestCashPurchase({ quoteId: quote.quoteId, requestId })
      openInfinitepayCheckout(result.checkoutUrl)
    } catch (err) {
      if (mounted.current) {
        setError(purchaseError(err))
        if (err.message === 'QUOTE_EXPIRED') {
          setExpired(true)
          setConfirmed(false)
        }
        // A failed response may still have reserved an order; history is authoritative.
        await onPurchaseChanged()
      }
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <Box
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
        Quanto EvoCash você quer?
      </Heading>
      {import.meta.env.DEV && import.meta.env.VITE_FINANCE_LOCAL_PREVIEW === 'true' && (
        <Flash>Ambiente de demonstração. Pagamentos simulados, sem cobrança real.</Flash>
      )}
      {error && (
        <Flash variant="danger" role="alert">
          {error}
        </Flash>
      )}
      {loading && <Spinner aria-label="Carregando preço do EvoCash" />}
      {!loading && !settings && (
        <Text as="p">O preço está indisponível. Atualize a página para tentar novamente.</Text>
      )}
      {settings && !settings.priceVersionId && (
        <Text as="p">Nenhum preço está disponível para novas compras.</Text>
      )}
      {settings?.priceVersionId && (
        <>
          {!settings.enabled && (
            <Flash variant="attention">A compra de EvoCash está temporariamente pausada.</Flash>
          )}
          {hasPendingPurchase && (
            <Flash variant="attention">
              Você já tem uma compra em andamento. Acompanhe em Minhas compras.
            </Flash>
          )}
          <Text as="p" sx={{ m: 0, color: 'fg.muted' }}>
            1 EvoCash = {formatPriceBRL(settings.unitPriceCentavos)}
          </Text>
          <Box as="form" onSubmit={review} sx={{ display: 'grid', gap: 3 }}>
            <FormControl required disabled={!settings.enabled || busy || hasPendingPurchase}>
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
            </FormControl>
            <Box sx={{ p: 3, bg: 'canvas.subtle', borderRadius: 2 }} aria-live="polite">
              <Text as="p" sx={{ m: 0, color: 'fg.muted' }}>
                Estimativa
              </Text>
              <Text as="p" sx={{ m: 0, fontSize: 4, fontWeight: 'bold' }}>
                {formatPriceBRL(estimate)}
              </Text>
              <Text as="p" sx={{ mt: 1, mb: 0, fontSize: 0, color: 'fg.muted' }}>
                O valor final será confirmado na próxima etapa.
              </Text>
            </Box>
            <Text as="p" sx={{ m: 0, fontSize: 0, color: 'fg.muted' }}>
              Limite diário: {settings.dailyQuantityLimit} EvoCash (dia UTC). Limite total:{' '}
              {settings.totalQuantityLimit} EvoCash. Compras em andamento também podem reservar
              esses limites.
            </Text>
            <Box>
              <Button
                type="submit"
                variant="primary"
                disabled={!valid || busy || !settings.enabled || hasPendingPurchase}
              >
                {busy && !quote ? 'Consultando…' : quote ? 'Atualizar cotação' : 'Revisar compra'}
              </Button>
            </Box>
          </Box>
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
              <Heading as="h3" sx={{ fontSize: 2 }}>
                Confirme sua compra
              </Heading>
              <Text as="p" sx={{ m: 0 }}>
                {quote.quantity} EvoCash × {formatPriceBRL(quote.unitPriceCentavos)}
              </Text>
              <Text as="p" sx={{ m: 0, fontSize: 4, fontWeight: 'bold' }}>
                Total: {formatPriceBRL(quote.totalCentavos)}
              </Text>
              <Text as="p" sx={{ m: 0, fontSize: 0 }}>
                Cotação válida até {priceDate(quote.expiresAt)}.
              </Text>
              {expired && (
                <Flash variant="attention" role="status">
                  Esta cotação expirou. Atualize a cotação para continuar.
                </Flash>
              )}
              <FormControl disabled={expired || busy || hasPendingPurchase}>
                <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <FormControl.Label>
                  Confirmo a quantidade e o valor total desta compra.
                </FormControl.Label>
              </FormControl>
              <Text as="p" sx={{ m: 0, fontSize: 0, color: 'fg.muted' }}>
                O pagamento acontece na InfinitePay, com as opções disponíveis no checkout. O
                EvoCash será liberado somente após a confirmação do pagamento. Não há renovação
                automática.
              </Text>
              <Box>
                <Button
                  variant="primary"
                  onClick={checkout}
                  disabled={!confirmed || expired || busy || hasPendingPurchase}
                >
                  {busy ? 'Preparando pagamento…' : 'Ir para o pagamento seguro'}
                </Button>
              </Box>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

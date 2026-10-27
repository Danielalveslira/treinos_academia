import { useRef, useState } from 'react'
import { Box, Button, Checkbox, Flash, FormControl, Text, TextInput } from '@primer/react'
import { Link } from 'react-router-dom'
import { quoteCommercialOrder, confirmCommercialOrder } from '../services/commercialService'
import { commercialDate, commercialError } from '../utils/commercial'
import { useWallet } from '../hooks/useWallet'
export default function CommercialLeasePurchase({ resourceId, tariff, expiresAt, onComplete }) {
  const [days, setDays] = useState('1'),
    [quote, setQuote] = useState(null),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const lock = useRef(false),
    intent = useRef(null)
  const { wallet, refresh } = useWallet()
  async function run(pay) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (pay) {
        await confirmCommercialOrder(quote.id, confirmed)
        intent.current = null
        setQuote(null)
        setConfirmed(false)
        await refresh()
        await onComplete()
      } else {
        intent.current ||= crypto.randomUUID()
        setQuote(await quoteCommercialOrder(resourceId, days, intent.current))
        setConfirmed(false)
      }
    } catch (e) {
      setError(commercialError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'border.default', pt: 3, mt: 3 }}>
      <Text as="h3" sx={{ fontSize: 2 }}>
        Contratar ou renovar publicação
      </Text>
      <Text as="p">
        A contratação vale para toda a vitrine. Não há cobrança por produto nem renovação
        automática.
      </Text>
      <Text as="p">
        {tariff?.salesEnabled
          ? `${tariff.price} EvoCash/dia · ${tariff.minDays} a ${tariff.maxDays} dias`
          : 'Novas contratações indisponíveis.'}
      </Text>
      <FormControl disabled={busy}>
        <FormControl.Label>Dias de publicação</FormControl.Label>
        <TextInput
          block
          inputMode="numeric"
          value={days}
          onChange={(e) => {
            setDays(e.target.value)
            setQuote(null)
            setConfirmed(false)
            intent.current = null
          }}
        />
      </FormControl>
      <Button
        sx={{ mt: 2 }}
        disabled={busy || !tariff?.salesEnabled || !/^[1-9][0-9]{0,3}$/.test(days)}
        onClick={() => run(false)}
      >
        Revisar contratação
      </Button>
      {error && (
        <Flash variant="danger" sx={{ mt: 2 }}>
          {error}
        </Flash>
      )}
      {quote && (
        <Box sx={{ mt: 3 }}>
          <Text as="p">
            {quote.durationDays} dias × {quote.unitPriceCash} EvoCash ={' '}
            <strong>{quote.totalCash} EvoCash</strong>
          </Text>
          <Text as="p">
            Vencimento previsto:{' '}
            {commercialDate(
              new Date(
                Math.max(
                  new Date(quote.createdAt).getTime(),
                  expiresAt ? new Date(expiresAt).getTime() : 0
                ) +
                  Number(quote.durationDays) * 86400000
              ).toISOString()
            )}
            . O período definitivo será calculado pelo banco na confirmação.
          </Text>
          <Text as="p">Cotação válida até {commercialDate(quote.quoteExpiresAt)}.</Text>
          {BigInt(String(wallet?.cashBalance ?? wallet?.cash_balance ?? 0)) <
            BigInt(quote.totalCash) && (
            <Flash sx={{ mb: 2 }}>
              Saldo insuficiente. <Link to="/evocash">Adquirir EvoCash</Link>. Após a recarga, volte
              e confirme a contratação.
            </Flash>
          )}
          <FormControl disabled={busy}>
            <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <FormControl.Label>Autorizo o débito de {quote.totalCash} EvoCash</FormControl.Label>
          </FormControl>
          <Button
            variant="primary"
            sx={{ mt: 2 }}
            disabled={busy || !confirmed}
            onClick={() => run(true)}
          >
            Confirmar contratação
          </Button>
        </Box>
      )}
    </Box>
  )
}

import { useRef, useState } from 'react'
import { Box, Button, Checkbox, Flash, FormControl, Text, TextInput } from '@primer/react'
import {
  confirmCommercialOrderWithTerms,
  quoteCommercialOrder,
} from '../services/commercialService'
import { commercialDate, commercialError } from '../utils/commercial'
import { useWallet } from '../hooks/useWallet'
// Only mounted in an explicitly configured local development preview.
export default function CommercialContractPreview() {
  const [resource, setResource] = useState('')
  const [days, setDays] = useState('1')
  const [quote, setQuote] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const { refresh } = useWallet()
  function edit(setter, value) {
    setter(value)
    setQuote(null)
    setConfirmed(false)
    setError('')
  }
  async function run(pay) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = pay
        ? await confirmCommercialOrderWithTerms(quote.id, quote.terms)
        : await quoteCommercialOrder(resource, days, crypto.randomUUID())
      setQuote(result)
      setConfirmed(false)
      if (pay) await refresh()
    } catch (e) {
      setError(commercialError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Box
      sx={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        my: 3,
      }}
    >
      <Flash sx={{ mb: 3 }}>
        Laboratório local · recurso e EvoCash sintéticos. Nenhuma publicação ou cobrança real.
      </Flash>
      <FormControl disabled={busy}>
        <FormControl.Label>ID do recurso sintético</FormControl.Label>
        <TextInput block value={resource} onChange={(e) => edit(setResource, e.target.value)} />
      </FormControl>
      <FormControl disabled={busy} sx={{ my: 2 }}>
        <FormControl.Label>Dias para contratar ou renovar</FormControl.Label>
        <TextInput
          inputMode="numeric"
          value={days}
          onChange={(e) => edit(setDays, e.target.value)}
        />
      </FormControl>
      <Button
        disabled={busy || !resource || !/^[1-9][0-9]{0,3}$/.test(days)}
        onClick={() => run(false)}
      >
        Solicitar cotação comercial
      </Button>
      {error && (
        <Flash variant="danger" sx={{ mt: 2 }}>
          {error}
        </Flash>
      )}
      {quote && (
        <Box sx={{ mt: 3, overflowWrap: 'anywhere' }}>
          <Text as="p">
            {quote.durationDays} dias × {quote.unitPriceCash} EvoCash ={' '}
            <strong>{quote.totalCash} EvoCash</strong>
          </Text>
          <Text as="p">
            Pedido: {quote.id} · {quote.status}
          </Text>
          {quote.status === 'quoted' ? (
            <>
              <Text as="p">
                Cotação válida até {commercialDate(quote.quoteExpiresAt)}. A elegibilidade será
                revalidada no banco.
              </Text>
              <FormControl disabled={busy}>
                <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <FormControl.Label>
                  Confirmo o débito de {quote.totalCash} EvoCash
                </FormControl.Label>
              </FormControl>
              <Button
                variant="primary"
                disabled={busy || !confirmed}
                onClick={() => run(true)}
                sx={{ mt: 2 }}
              >
                Confirmar contratação
              </Button>
            </>
          ) : (
            <Flash variant="success">
              Direito concedido. Período contratado: {commercialDate(quote.periodStart)} até{' '}
              {commercialDate(quote.periodEnd)}.
            </Flash>
          )}
        </Box>
      )}
    </Box>
  )
}

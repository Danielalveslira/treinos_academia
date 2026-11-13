import { RefundPolicyNotice } from './Refunds'
import { useRef, useState } from 'react'
import { Box, Button, Flash, FormControl, Text, TextInput } from '@primer/react'
import { Link } from 'react-router-dom'
import {
  quoteCommercialOrder,
  confirmCommercialOrderWithTerms,
} from '../services/commercialService'
import { CommercialTermsAcceptance } from './CommercialTermsAcceptance'
import { commercialTermsState } from '../utils/commercialTerms'
import { clampInitialDays, commercialDate, commercialError } from '../utils/commercial'
import { useWallet } from '../hooks/useWallet'

export default function CommercialLeasePurchase({
  resourceId,
  tariff,
  expiresAt,
  onComplete,
  subjectLabel = 'vitrine',
  resourceName,
  initialDays = null,
  prepareResource,
  compact = false,
}) {
  const [days, setDays] = useState(() => clampInitialDays(initialDays, tariff)),
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
        if (!confirmed || commercialTermsState(quote.terms) !== 'ready') return
        const purchase = await confirmCommercialOrderWithTerms(quote.id, quote.terms)
        if (purchase.status !== 'fulfilled') throw new Error('ENTITLEMENT_BLOCKED')
        intent.current = null
        setQuote(null)
        setConfirmed(false)
        try {
          await onComplete?.(purchase)
        } catch {
          // The charge already succeeded; a local UI callback cannot undo it.
        } finally {
          Promise.resolve()
            .then(refresh)
            .catch(() => {})
        }
      } else {
        const effectiveResourceId = prepareResource
          ? (await prepareResource()).resourceId
          : resourceId
        intent.current ||= crypto.randomUUID()
        setQuote(await quoteCommercialOrder(effectiveResourceId, days, intent.current))
        setConfirmed(false)
      }
    } catch (e) {
      if (e?.message === 'QUOTE_EXPIRED') {
        intent.current = null
        setQuote(null)
        setConfirmed(false)
      }
      setError(commercialError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Box
      sx={
        compact
          ? { display: 'grid', gap: 3, minWidth: 0 }
          : { borderTop: '1px solid', borderColor: 'border.default', pt: 3, mt: 3 }
      }
    >
      {!compact && <RefundPolicyNotice snapshot={quote?.refundPolicy} />}
      {!compact && (
        <Text as="h3" sx={{ fontSize: 2 }}>
          Contratar ou renovar publicação
        </Text>
      )}
      {resourceName && (
        <Text as="p" sx={{ overflowWrap: 'anywhere' }}>
          Publicação de <strong>{resourceName}</strong>
        </Text>
      )}
      {!compact && (
        <Text as="p">
          A contratação publica este {subjectLabel} pelo período confirmado. Não há renovação
          automática.
        </Text>
      )}
      <Text as="p">
        {tariff?.salesEnabled
          ? `${tariff.price} EvoCash/dia · ${tariff.minDays} a ${tariff.maxDays} dias`
          : 'Novas contratações indisponíveis.'}
      </Text>
      {compact &&
        tariff?.salesEnabled &&
        /^[1-9][0-9]{0,3}$/.test(days) &&
        Number(days) >= Number(tariff.minDays) &&
        Number(days) <= Number(tariff.maxDays) &&
        !quote && (
          <Text as="p">
            Total estimado:{' '}
            <strong>{(BigInt(tariff.price) * BigInt(days)).toString()} EvoCash</strong>
          </Text>
        )}
      <FormControl disabled={busy}>
        <FormControl.Label>Duração em dias</FormControl.Label>
        <TextInput
          block
          inputMode="numeric"
          type="number"
          min={tariff?.minDays}
          max={tariff?.maxDays}
          step="1"
          value={days}
          onChange={(e) => {
            setDays(e.target.value)
            setQuote(null)
            setConfirmed(false)
            intent.current = null
          }}
        />
      </FormControl>
      {!quote && (
        <Button
          sx={{ mt: 2 }}
          disabled={
            busy ||
            !tariff?.salesEnabled ||
            !/^[1-9][0-9]{0,3}$/.test(days) ||
            Number(days) < Number(tariff?.minDays) ||
            Number(days) > Number(tariff?.maxDays)
          }
          onClick={() => run(false)}
        >
          {compact ? 'Revisar valor' : 'Revisar contratação'}
        </Button>
      )}
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
            {compact ? '' : '. O período definitivo será calculado pelo banco na confirmação.'}
          </Text>
          {!compact && (
            <Text as="p">Cotação válida até {commercialDate(quote.quoteExpiresAt)}.</Text>
          )}
          <Text as="p">
            Saldo disponível: {wallet?.cashBalance ?? wallet?.cash_balance ?? 0} EvoCash
          </Text>
          {BigInt(String(wallet?.cashBalance ?? wallet?.cash_balance ?? 0)) <
            BigInt(quote.totalCash) && (
            <Flash sx={{ mb: 2 }}>
              Saldo insuficiente. <Link to="/evocash">Adquirir EvoCash</Link>. Após a recarga, volte
              e confirme a contratação.
            </Flash>
          )}
          <CommercialTermsAcceptance
            terms={quote.terms}
            compact={compact}
            checked={confirmed}
            onChange={setConfirmed}
            disabled={busy}
            summary={
              compact
                ? [
                    ['Duração', `${quote.durationDays} dias, sem renovação automática`],
                    ['Total a debitar', `${quote.totalCash} EvoCash`],
                  ]
                : [
                    [
                      'Serviço',
                      resourceName
                        ? `Publicação de ${resourceName}`
                        : `Publicação de ${subjectLabel}`,
                    ],
                    ['Duração', `${quote.durationDays} dias, sem renovação automática`],
                    ['Preço', `${quote.unitPriceCash} EvoCash por dia`],
                    ['Total a debitar', `${quote.totalCash} EvoCash`],
                    [
                      'Publicação',
                      'Somente enquanto o conteúdo estiver aprovado e o direito ativo',
                    ],
                    ['Cotação válida até', commercialDate(quote.quoteExpiresAt)],
                  ]
            }
          />
          {compact && (
            <Text as="p" sx={{ fontSize: 0, mt: 2, mb: 0 }}>
              <Link to="/politica-de-reembolso" target="_blank" rel="noopener">
                Política de reembolso
              </Link>
            </Text>
          )}
          <Button
            variant="primary"
            sx={{ mt: 2 }}
            disabled={
              busy ||
              !confirmed ||
              commercialTermsState(quote.terms) !== 'ready' ||
              BigInt(String(wallet?.cashBalance ?? wallet?.cash_balance ?? 0)) <
                BigInt(quote.totalCash)
            }
            onClick={() => run(true)}
          >
            {compact ? 'Confirmar promoção' : 'Confirmar contratação'}
          </Button>
        </Box>
      )}
    </Box>
  )
}

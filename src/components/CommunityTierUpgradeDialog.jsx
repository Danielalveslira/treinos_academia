import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Button, Dialog, Flash, Spinner, Text } from '@primer/react'
import {
  listCommunityCreationProducts,
  quoteCommunityTierUpgrade,
  upgradeCommunityTier,
} from '../services/communityCreationService'
import { resolveRequestId } from '../utils/cashPurchaseFlow'
import {
  PAYMENT_LABELS,
  TIER_LABELS,
  TIER_RANK,
  creationErrorMessage,
  newIdempotencyKey,
  retentionCopy,
} from '../utils/communityCreation'
import '../styles/community-creation.css'

// Upgrade de tier (upgrade_community_tier já existia no backend, sem nenhuma UI -- esta é a
// primeira). Sempre cotiza antes de cobrar (quote_community_tier_upgrade, read-only) e manda o
// valor cotado de volta como expectedAmount: se o preço mudar entre a cotação e a confirmação,
// o servidor recusa com PRICE_CHANGED em vez de cobrar um valor diferente do aprovado -- aqui
// isso só pede uma cotação nova e exige confirmação explícita de novo, sem gerar chave de
// idempotência nova sozinho (a intenção do usuário não mudou só porque o preço mudou).
export function CommunityTierUpgradeDialog({ communityId, currentTier, onClose, onUpgraded }) {
  const [products, setProducts] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [tier, setTier] = useState(null)
  const [paymentMethod, setPaymentMethod] = useState(null)
  const [quote, setQuote] = useState(null)
  const [quoting, setQuoting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const pendingAttemptRef = useRef(null)
  const confirmingRef = useRef(false)

  useEffect(() => {
    let active = true
    listCommunityCreationProducts()
      .then((list) => {
        if (active) setProducts(list)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
    return () => {
      active = false
    }
  }, [])

  const fetchQuote = useCallback(
    async (nextTier, nextMethod) => {
      setQuoting(true)
      setError('')
      setQuote(null)
      try {
        const result = await quoteCommunityTierUpgrade({
          communityId,
          tier: nextTier,
          paymentMethod: nextMethod,
        })
        setQuote(result)
      } catch (err) {
        console.error('[CommunityTierUpgradeDialog] quoteCommunityTierUpgrade:', err)
        setError(creationErrorMessage(err))
      } finally {
        setQuoting(false)
      }
    },
    [communityId]
  )

  function selectTier(nextTier) {
    setTier(nextTier)
    setPaymentMethod(null)
    setQuote(null)
  }

  function selectPayment(method) {
    setPaymentMethod(method)
    fetchQuote(tier, method)
  }

  async function confirm() {
    if (confirmingRef.current || !quote?.chargeable) return
    confirmingRef.current = true
    setConfirming(true)
    setError('')
    const attemptKey = `${communityId}|${tier}|${paymentMethod}|${quote.amountDue}`
    const idempotencyKey = resolveRequestId(pendingAttemptRef.current, attemptKey, newIdempotencyKey)
    pendingAttemptRef.current = { key: attemptKey, requestId: idempotencyKey }
    try {
      const result = await upgradeCommunityTier({
        communityId,
        tier,
        paymentMethod,
        idempotencyKey,
        expectedAmount: quote.amountDue,
      })
      pendingAttemptRef.current = null
      onUpgraded?.(result)
    } catch (err) {
      console.error('[CommunityTierUpgradeDialog] upgradeCommunityTier:', err)
      if (err?.message === 'PRICE_CHANGED') {
        // Preço mudou entre a cotação e a confirmação: nunca cobra um valor diferente do
        // aprovado -- pede cotação nova e exige que o usuário confirme de novo explicitamente.
        pendingAttemptRef.current = null
        await fetchQuote(tier, paymentMethod)
        setError('O preço mudou. Confira o novo valor abaixo e confirme de novo.')
      } else {
        setError(creationErrorMessage(err))
      }
    } finally {
      confirmingRef.current = false
      setConfirming(false)
    }
  }

  const upgradable = (products || []).filter(
    (product) => (TIER_RANK[product.tier] ?? 1) > (TIER_RANK[currentTier] ?? 1) && product.free !== true
  )

  const paymentOptions = tier
    ? ['evocoins', 'evocash'].filter((method) => {
        const product = upgradable.find((item) => item.tier === tier)
        return method === 'evocoins' ? product?.evoCoinsPrice > 0 : product?.evoCashPrice > 0
      })
    : []

  return (
    <Dialog title="Melhorar comunidade" onClose={onClose} width="medium">
      <Box className="community-upgrade-dialog">
        {products === null && !loadError && <Spinner aria-label="Carregando modalidades" />}
        {loadError && <Flash variant="danger">Não foi possível carregar as modalidades.</Flash>}

        {products !== null && upgradable.length === 0 && (
          <Flash variant="default">Esta comunidade já está na modalidade mais alta disponível.</Flash>
        )}

        {upgradable.length > 0 && (
          <div role="radiogroup" aria-label="Nova modalidade" className="community-choice-list">
            {upgradable.map((product) => {
              const copy = retentionCopy(product.postRetentionMode)
              return (
                <button
                  key={product.tier}
                  type="button"
                  role="radio"
                  aria-checked={tier === product.tier}
                  className={`community-choice${tier === product.tier ? ' is-selected' : ''}`}
                  onClick={() => selectTier(product.tier)}
                >
                  <span className="community-choice-title">{TIER_LABELS[product.tier]}</span>
                  <span className="community-choice-text">{copy.description}</span>
                </button>
              )
            })}
          </div>
        )}

        {tier && (
          <div role="radiogroup" aria-label="Forma de pagamento" className="community-choice-list">
            {paymentOptions.map((method) => (
              <button
                key={method}
                type="button"
                role="radio"
                aria-checked={paymentMethod === method}
                className={`community-choice${paymentMethod === method ? ' is-selected' : ''}`}
                onClick={() => selectPayment(method)}
              >
                <span className="community-choice-title">{PAYMENT_LABELS[method]}</span>
              </button>
            ))}
          </div>
        )}

        {quoting && <Spinner aria-label="Calculando valor" />}

        {quote && (
          <Box sx={{ mt: 2 }}>
            <Text as="p">
              Valor da modalidade: {quote.listPrice} {PAYMENT_LABELS[paymentMethod]}
            </Text>
            {quote.alreadyCredited > 0 && (
              <Text as="p">
                Já pago nesta comunidade ({PAYMENT_LABELS[paymentMethod]}): {quote.alreadyCredited}
              </Text>
            )}
            <Text as="p" sx={{ fontWeight: 'bold' }}>
              {quote.chargeable
                ? `A pagar agora: ${quote.amountDue} ${PAYMENT_LABELS[paymentMethod]}`
                : 'Não há valor a cobrar para esta mudança.'}
            </Text>
          </Box>
        )}

        {error && (
          <Flash variant="danger" role="alert" sx={{ mt: 2 }}>
            {error}
          </Flash>
        )}

        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
          <Button type="button" onClick={onClose} disabled={confirming}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={confirm}
            loading={confirming}
            disabled={!quote?.chargeable || confirming}
          >
            Confirmar e pagar
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}

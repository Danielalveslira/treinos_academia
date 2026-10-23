import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Box, Button, Flash, Heading, Label, Spinner, Text } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { useCashPurchases } from '../hooks/useCashPurchases'
import {
  cancelMyCashPurchase,
  checkInfinitepayPurchase,
  getCashPurchaseSettings,
  requestCashPurchase,
} from '../services/cashPurchaseService'
import { CashPackageCards } from '../components/CashPackageCards'
import { CopyButton } from '../components/CopyButton'
import { formatCentavosBRL, formatDateTime } from '../utils/format'
import {
  hasPendingCashPurchase,
  cashPurchaseStatusLabel,
  openInfinitepayCheckout,
  abbreviateProtocol,
  USER_CASH_PURCHASE_STATUS_LABELS as STATUS_LABELS,
} from '../utils/cashPurchaseFlow'

// O crédito é confirmado no backend após payment_check; esta página apenas abre o checkout.
export default function EvoCash() {
  const { user } = useAuth()
  const [settings, setSettings] = useState({ packages: [] })
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const [buyingPackageId, setBuyingPackageId] = useState(null)
  const [cancellingPurchaseId, setCancellingPurchaseId] = useState(null)
  const [error, setError] = useState('')
  const [checkoutReturn, setCheckoutReturn] = useState(null)
  const {
    purchases,
    loading,
    hasMore,
    loadMore,
    error: listError,
    refresh,
  } = useCashPurchases(user?.uid)

  useEffect(() => {
    let active = true
    getCashPurchaseSettings()
      .then((result) => {
        if (active) setSettings(result)
      })
      .finally(() => {
        if (active) setLoadingSettings(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (searchParams.get('checkout_return') !== '1') return
    const purchaseId = searchParams.get('purchase_id')
    if (!/^[0-9a-f-]{36}$/i.test(purchaseId || '')) return
    const hints = {
      order_nsu: searchParams.get('order_nsu'),
      transaction_nsu: searchParams.get('transaction_nsu'),
      slug: searchParams.get('slug'),
    }
    let active = true
    setCheckoutReturn('checking')
    checkInfinitepayPurchase(purchaseId, hints)
      .then((result) => {
        if (!active) return
        setCheckoutReturn(
          result.status === 'credited'
            ? 'credited'
            : result.status === 'needs_review' || result.status === 'held_in_case'
              ? 'review'
              : 'pending'
        )
        refresh()
        if (result.status === 'credited') setSearchParams({}, { replace: true })
      })
      .catch(() => {
        if (active) setCheckoutReturn('pending')
      })
    return () => {
      active = false
    }
  }, [searchParams, setSearchParams, refresh])

  useEffect(() => {
    if (checkoutReturn !== 'pending') return
    const purchaseId = searchParams.get('purchase_id')
    if (
      purchases.some((purchase) => purchase.id === purchaseId && purchase.status === 'credited')
    ) {
      setCheckoutReturn('credited')
      setSearchParams({}, { replace: true })
    }
  }, [checkoutReturn, purchases, searchParams, setSearchParams])

  const hasPendingPurchase = hasPendingCashPurchase(purchases)

  async function buy(packageId) {
    if (buyingPackageId) return
    setError('')
    setBuyingPackageId(packageId)
    try {
      const result = await requestCashPurchase({ packageId })
      openInfinitepayCheckout(result.checkoutUrl)
    } catch (err) {
      const KNOWN_ERRORS = {
        PENDING_CASH_PURCHASE_EXISTS: 'Você já tem uma compra de EvoCash pendente.',
        CASH_PACKAGE_UNAVAILABLE: 'Este pacote não está mais disponível.',
        INFINITEPAY_NOT_CONFIGURED: 'Pagamentos estão temporariamente indisponíveis.',
        INFINITEPAY_LINK_FAILED: 'Não foi possível abrir o pagamento. Tente novamente.',
        INVALID_CHECKOUT_URL: 'Não foi possível abrir o pagamento. Tente novamente.',
        CHECKOUT_SAVE_FAILED: 'Não foi possível abrir o pagamento. Tente novamente.',
        CHECKOUT_IN_PROGRESS: 'Não foi possível abrir o pagamento. Tente novamente.',
        CHECKOUT_RECONCILIATION_REQUIRED: 'Não foi possível abrir o pagamento. Tente novamente.',
      }
      setError(
        KNOWN_ERRORS[err?.message] || 'Não foi possível solicitar a compra. Tente novamente.'
      )
    } finally {
      setBuyingPackageId(null)
    }
  }

  async function cancelPurchase(purchaseId) {
    if (cancellingPurchaseId) return
    setError('')
    setCancellingPurchaseId(purchaseId)
    try {
      await cancelMyCashPurchase(purchaseId)
      await refresh()
    } catch {
      setError('Não foi possível cancelar a compra. Tente novamente.')
    } finally {
      setCancellingPurchaseId(null)
    }
  }

  return (
    <div className="profile-page">
      <header className="profile-page-heading">
        <span className="profile-eyebrow">EVOCASH</span>
        <h1>Comprar EvoCash</h1>
        <p>
          Compre créditos para promover suas publicações ou comunidades. O saldo é liberado após a
          confirmação do pagamento.
        </p>
        <Link to="/entenda-suas-moedas">Entenda EvoCash e EvoCoins</Link>
      </header>

      {error && (
        <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}

      {checkoutReturn && (
        <Flash sx={{ mb: 3 }} role="status">
          {checkoutReturn === 'checking'
            ? 'Confirmando seu pagamento…'
            : checkoutReturn === 'credited'
              ? 'Pagamento confirmado. Consulte seu saldo atualizado.'
              : checkoutReturn === 'review'
                ? 'Pagamento recebido e em análise financeira. O saldo ainda não foi liberado.'
                : 'Pagamento ainda não confirmado. Acompanhe em Minhas compras.'}
        </Flash>
      )}

      <section aria-labelledby="packages-heading" style={{ marginBottom: '2rem' }}>
        <Heading as="h2" id="packages-heading" sx={{ fontSize: 2, mb: 2 }}>
          Pacotes disponíveis
        </Heading>
        {loadingSettings && <Spinner aria-label="Carregando pacotes" />}
        {!loadingSettings && settings.packages.length === 0 && (
          <Text as="p" sx={{ color: 'fg.muted' }}>
            Nenhum pacote disponível no momento.
          </Text>
        )}
        {hasPendingPurchase && (
          <Flash sx={{ mb: 3 }}>
            Você já tem uma compra em andamento — acompanhe em "Minhas compras" abaixo.
          </Flash>
        )}
        {!loadingSettings && settings.packages.length > 0 && (
          <CashPackageCards
            packages={settings.packages}
            buyingPackageId={buyingPackageId}
            disabled={!!buyingPackageId || hasPendingPurchase}
            onBuy={buy}
          />
        )}
      </section>

      <section aria-labelledby="my-purchases-heading">
        <Heading as="h2" id="my-purchases-heading" sx={{ fontSize: 2, mb: 2 }}>
          Minhas compras
        </Heading>
        {listError && (
          <Flash variant="danger" sx={{ mb: 3 }}>
            {listError} <Button onClick={refresh}>Tentar novamente</Button>
          </Flash>
        )}
        {loading && purchases.length === 0 && <Spinner aria-label="Carregando compras" />}
        {!loading && purchases.length === 0 && (
          <Text as="p" sx={{ color: 'fg.muted' }}>
            Você ainda não comprou EvoCash.
          </Text>
        )}
        {purchases.map((purchase) => (
          <Box
            as="article"
            key={purchase.id}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              minWidth: 0,
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              p: 3,
              mb: 2,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 2,
                minWidth: 0,
              }}
            >
              <Text as="p" sx={{ fontWeight: 'bold', m: 0, minWidth: 0, wordBreak: 'break-word' }}>
                {purchase.packageLabel}
              </Text>
              <Label variant={cashPurchaseStatusLabel(purchase, STATUS_LABELS).variant}>
                {cashPurchaseStatusLabel(purchase, STATUS_LABELS).text}
              </Label>
            </Box>

            <Text as="p" sx={{ fontSize: 0, m: 0 }}>
              {formatCentavosBRL(purchase.amountCentavos)} — {purchase.cashAmount} EvoCash
            </Text>

            <Box sx={{ minWidth: 0 }}>
              <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                Protocolo
              </Text>
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 2,
                  minWidth: 0,
                }}
              >
                <Text
                  as="span"
                  title={purchase.id}
                  sx={{
                    fontSize: 0,
                    fontFamily: 'mono',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                    minWidth: 0,
                  }}
                >
                  {abbreviateProtocol(purchase.id)}
                </Text>
                <CopyButton
                  value={purchase.id}
                  label="Copiar"
                  successMessage="Protocolo copiado"
                  testId={`copy-protocol-${purchase.id}`}
                />
              </Box>
            </Box>

            <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
              Data: {formatDateTime(purchase.createdAt ? new Date(purchase.createdAt) : null)}
            </Text>

            {purchase.status === 'pending' && purchase.paymentProvider === 'infinitepay' && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {purchase.checkoutUrl && (
                  <Button as="a" href={purchase.checkoutUrl}>
                    Continuar pagamento
                  </Button>
                )}
                <Button
                  variant="danger"
                  disabled={!!cancellingPurchaseId}
                  onClick={() => cancelPurchase(purchase.id)}
                >
                  {cancellingPurchaseId === purchase.id ? 'Cancelando…' : 'Cancelar'}
                </Button>
              </Box>
            )}

            {purchase.status === 'pending' &&
              purchase.paymentProvider === 'infinitepay' &&
              !purchase.checkoutUrl && (
                <Text as="p" sx={{ fontSize: 0, color: 'attention.fg', m: 0 }}>
                  {purchase.checkoutUncertain
                    ? 'O checkout não abriu. Este pedido precisa de conciliação antes de pagar.'
                    : 'O checkout está sendo preparado. Nenhum pagamento foi iniciado.'}
                </Text>
              )}

            {purchase.status === 'credited' && !purchase.reversedCentavos && (
              <Box>
                <Text as="p" sx={{ fontWeight: 'bold', color: 'success.fg', m: 0 }}>
                  Pagamento confirmado
                </Text>
                <Text as="p" sx={{ m: 0 }}>
                  EvoCash creditado
                </Text>
              </Box>
            )}

            {purchase.reversedCentavos > 0 && (
              <Text as="p" sx={{ fontSize: 0, m: 0 }}>
                Estorno registrado: {formatCentavosBRL(purchase.reversedCentavos)}. Consulte o
                atendimento para detalhes.
              </Text>
            )}
            {purchase.status === 'needs_review' && (
              <Text as="p" sx={{ fontSize: 0, m: 0 }}>
                Pagamento recebido e em análise financeira. O saldo ainda não foi liberado.
              </Text>
            )}
            {purchase.paidAfterCancelAt && (
              <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                Pagamento recebido após o cancelamento e conciliado automaticamente.
              </Text>
            )}

            {purchase.status === 'cancelled' && purchase.cancelReason && (
              <Text
                as="p"
                sx={{
                  fontSize: 0,
                  color: 'fg.muted',
                  m: 0,
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                }}
              >
                Motivo: {purchase.cancelReason}
              </Text>
            )}
          </Box>
        ))}
        {hasMore && (
          <Button onClick={loadMore} disabled={loading}>
            Carregar mais compras
          </Button>
        )}
      </section>
    </div>
  )
}

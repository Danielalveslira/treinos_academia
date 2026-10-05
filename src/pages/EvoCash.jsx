import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Button, Flash, Heading, Label, Spinner, Text } from '@primer/react'
import { SparkleFillIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useCashPurchases } from '../hooks/useCashPurchases'
import { checkInfinitepayPurchase, getCashPurchaseSettings, requestCashPurchase, requestInfinitepayCancellation } from '../services/cashPurchaseService'
import { CashPackageCards } from '../components/CashPackageCards'
import { CopyButton } from '../components/CopyButton'
import { PixPaymentInstructions } from '../components/PixPaymentInstructions'
import { formatCentavosBRL, formatDateTime } from '../utils/format'
import {
  hasPendingCashPurchase,
  cashPurchaseStatusLabel,
  openInfinitepayCheckout,
  abbreviateProtocol,
  USER_CASH_PURCHASE_STATUS_LABELS as STATUS_LABELS,
} from '../utils/cashPurchaseFlow'

// EvoCash (Fase 4): pacotes, solicitar compra, instruções de PIX e "minhas compras" --
// tudo numa página só, já que são passos do mesmo fluxo. O crédito em si só acontece
// depois de um admin confirmar o pagamento manualmente (ver AdminCashPurchases.jsx);
// esta página nunca credita nada sozinha.
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
        setCheckoutReturn(result.status === 'credited' ? 'credited' : 'pending')
        refresh()
        if (result.status === 'credited') setSearchParams({}, { replace: true })
      })
      .catch(() => { if (active) setCheckoutReturn('pending') })
    return () => { active = false }
  }, [searchParams, setSearchParams, refresh])

  useEffect(() => {
    if (checkoutReturn !== 'pending') return
    const purchaseId = searchParams.get('purchase_id')
    if (purchases.some((purchase) => purchase.id === purchaseId && purchase.status === 'credited')) {
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
      setError(KNOWN_ERRORS[err?.message] || 'Não foi possível solicitar a compra. Tente novamente.')
    } finally {
      setBuyingPackageId(null)
    }
  }

  async function requestCancellation(purchaseId) {
    if (cancellingPurchaseId) return
    setError('')
    setCancellingPurchaseId(purchaseId)
    try {
      await requestInfinitepayCancellation(purchaseId)
      await refresh()
    } catch {
      setError('Não foi possível solicitar o cancelamento. Tente novamente.')
    } finally {
      setCancellingPurchaseId(null)
    }
  }

  return (
    <div className="profile-page">
      <header className="profile-page-heading">
        <span className="profile-eyebrow">EVOCASH</span>
        <h1>Comprar EvoCash</h1>
        <p>A moeda premium do Evolutus para recursos exclusivos, comunidades e destaques.</p>
      </header>

      {/* Sem data nem contagem regressiva inventada -- "por tempo limitado" e "serão
          reajustados posteriormente" nunca com prazo específico, só a condição real. */}
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          alignItems: 'flex-start',
          border: '1px solid',
          borderColor: 'attention.emphasis',
          bg: 'attention.subtle',
          borderRadius: 2,
          p: 3,
          mb: 4,
        }}
      >
        <Box sx={{ color: 'attention.fg', flexShrink: 0, display: 'flex', pt: '2px' }}>
          <SparkleFillIcon size={18} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Text as="p" sx={{ fontWeight: 'bold', m: 0, color: 'attention.fg' }}>
            Valores especiais por tempo limitado
          </Text>
          <Text as="p" sx={{ fontSize: 1, m: 0, mt: 1 }}>
            Os preços atuais estão abaixo da tabela padrão do EvoCash e serão reajustados posteriormente.
          </Text>
        </Box>
      </Box>

      {error && (
        <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}

      {checkoutReturn && <Flash sx={{ mb: 3 }} role="status">
        {checkoutReturn === 'checking' ? 'Confirmando seu pagamento…' :
          checkoutReturn === 'credited' ? 'Pagamento confirmado. Seu saldo foi atualizado.' :
          'Pagamento ainda não confirmado. Acompanhe em Minhas compras.'}
      </Flash>}

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
            {purchases.some((purchase) => purchase.status === 'pending' && purchase.cancelRequestedAt)
              ? 'Seu pedido de cancelamento está em análise. Acompanhe em "Minhas compras" abaixo.'
              : 'Você já tem uma compra em andamento — acompanhe em "Minhas compras" abaixo.'}
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
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, minWidth: 0 }}>
                <Text
                  as="span"
                  title={purchase.id}
                  sx={{ fontSize: 0, fontFamily: 'mono', wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}
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

            {purchase.status === 'pending' && purchase.paymentProvider === 'infinitepay' && purchase.checkoutUrl && !purchase.cancelRequestedAt && (
              <Button as="a" href={purchase.checkoutUrl}>Continuar no checkout</Button>
            )}

            {purchase.status === 'pending' && purchase.paymentProvider === 'infinitepay' && !purchase.cancelRequestedAt && (
              <Box>
                <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mb: 2 }}>
                  Se desistiu, solicite o cancelamento. Um link já emitido pode continuar pagável até a conciliação.
                </Text>
                <Button variant="danger" disabled={!!cancellingPurchaseId}
                  onClick={() => requestCancellation(purchase.id)}>
                  {cancellingPurchaseId === purchase.id ? 'Solicitando…' : 'Solicitar cancelamento'}
                </Button>
              </Box>
            )}

            {purchase.status === 'pending' && purchase.paymentProvider === 'infinitepay' && purchase.cancelRequestedAt && (
              <Text as="p" sx={{ fontSize: 0, color: 'attention.fg', m: 0 }}>
                Solicitação recebida. Não use o link de pagamento; a equipe precisa conciliar o pedido com a InfinitePay.
              </Text>
            )}

            {purchase.status === 'pending' && purchase.paymentProvider === 'infinitepay' && !purchase.checkoutUrl && (
              <Text as="p" sx={{ fontSize: 0, color: 'attention.fg', m: 0 }}>
                {purchase.checkoutUncertain
                  ? 'O checkout não abriu. Este pedido precisa de conciliação antes de pagar.'
                  : 'O checkout está sendo preparado. Nenhum pagamento foi iniciado.'}
              </Text>
            )}

            {purchase.status === 'pending' && purchase.paymentProvider !== 'infinitepay' && (
              <PixPaymentInstructions
                purchaseId={purchase.id}
                packageLabel={purchase.packageLabel}
                cashAmount={purchase.cashAmount}
                amountCentavos={purchase.amountCentavos}
                qrCode={purchase.qrCode}
                qrCodeBase64={purchase.qrCodeBase64}
                ticketUrl={purchase.ticketUrl}
              />
            )}

            {purchase.status === 'credited' && (
              <Box>
                <Text as="p" sx={{ fontWeight: 'bold', color: 'success.fg', m: 0 }}>
                  Pagamento confirmado
                </Text>
                <Text as="p" sx={{ m: 0 }}>
                  EvoCash creditado
                </Text>
              </Box>
            )}

            {purchase.status === 'cancelled' && purchase.cancelReason && (
              <Text
                as="p"
                sx={{ fontSize: 0, color: 'fg.muted', m: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}
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

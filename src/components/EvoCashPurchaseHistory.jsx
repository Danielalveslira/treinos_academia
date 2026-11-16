import { Box, Button, Flash, Label, Spinner, Text } from '@primer/react'
import { RefundSourceButton } from './Refunds'
import { CopyButton } from './CopyButton'
import { formatCentavosBRL, formatDateTime } from '../utils/format'
import { serverNow } from '../utils/serverClock'
import {
  allowedInfinitepayCheckout,
  cashPurchaseStatusLabel,
  USER_CASH_PURCHASE_STATUS_LABELS,
} from '../utils/cashPurchaseFlow'

export function EvoCashPurchaseHistory({
  purchases,
  pendingPurchase,
  loading,
  error,
  hasMore,
  loadMore,
  refresh,
  cancellingPurchaseId,
  cancelPurchase,
  focusedPurchaseId,
  onRefundCreated,
}) {
  const visiblePurchases =
    pendingPurchase && !purchases.some((purchase) => purchase.id === pendingPurchase.id)
      ? [...purchases, pendingPurchase].sort(
          (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
        )
      : purchases
  return (
    <section aria-label="Compras de EvoCash">
      <Button onClick={refresh} disabled={loading} sx={{ mb: 3 }}>
        Atualizar compras
      </Button>
      {error && (
        <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
          {error} <Button onClick={refresh}>Tentar novamente</Button>
        </Flash>
      )}
      {loading && visiblePurchases.length === 0 && <Spinner aria-label="Carregando compras" />}
      {!loading && visiblePurchases.length === 0 && (
        <Text as="p">Você ainda não comprou EvoCash.</Text>
      )}
      {visiblePurchases.map((purchase) => {
        const status = cashPurchaseStatusLabel(purchase, USER_CASH_PURCHASE_STATUS_LABELS)
        const canContinue =
          purchase.status === 'pending' &&
          purchase.paymentProvider === 'infinitepay' &&
          purchase.checkoutUrl &&
          allowedInfinitepayCheckout(purchase.checkoutUrl) &&
          !purchase.checkoutUncertain &&
          (!purchase.checkoutValidUntil || Date.parse(purchase.checkoutValidUntil) > serverNow())
        return (
          <Box
            as="article"
            key={purchase.id}
            sx={{
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              p: 3,
              mb: 2,
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 2,
                minWidth: 0,
              }}
            >
              <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <Text as="p" sx={{ fontWeight: 'bold', m: 0 }}>
                  {purchase.purchaseLabel || `${purchase.cashAmount} EvoCash`}
                </Text>
                <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, my: 1 }}>
                  {formatDateTime(purchase.createdAt ? new Date(purchase.createdAt) : null)} ·{' '}
                  {formatCentavosBRL(purchase.amountCentavos)}
                </Text>
              </Box>
              <Label variant={status.variant}>{status.text}</Label>
            </Box>
            <details open={focusedPurchaseId === purchase.id}>
              <summary>Ver detalhes</summary>
              <Box sx={{ pt: 2, display: 'grid', gap: 2, overflowWrap: 'anywhere' }}>
                <Text as="p" sx={{ m: 0 }}>
                  Protocolo: {purchase.id}
                </Text>
                <CopyButton
                  value={purchase.id}
                  label="Copiar protocolo"
                  successMessage="Protocolo copiado"
                  testId={`copy-protocol-${purchase.id}`}
                />
                <Text as="p" sx={{ m: 0 }}>
                  Quantidade: {purchase.cashAmount} EvoCash · Valor original:{' '}
                  {formatCentavosBRL(purchase.amountCentavos)}
                </Text>
                {purchase.status === 'pending' && purchase.paymentProvider === 'infinitepay' && (
                  <>
                    {purchase.checkoutUncertain ? (
                      <Text as="p" sx={{ m: 0 }}>
                        O checkout precisa de conciliação. Aguarde a atualização antes de tentar
                        pagar novamente.
                      </Text>
                    ) : !purchase.checkoutUrl ? (
                      <Text as="p" sx={{ m: 0 }}>
                        O checkout está sendo preparado. Aguarde a atualização deste pedido.
                      </Text>
                    ) : !canContinue ? (
                      <Text as="p" sx={{ m: 0 }}>
                        O prazo deste checkout terminou. Atualize o histórico para acompanhar o
                        pedido.
                      </Text>
                    ) : (
                      <Button as="a" href={purchase.checkoutUrl}>
                        Continuar pagamento
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      disabled={!!cancellingPurchaseId}
                      onClick={() => cancelPurchase(purchase.id)}
                    >
                      {cancellingPurchaseId === purchase.id ? 'Cancelando…' : 'Cancelar compra'}
                    </Button>
                  </>
                )}
                {purchase.status === 'credited' && !purchase.reversedCentavos && (
                  <Text as="p" sx={{ m: 0 }}>
                    Pagamento confirmado. EvoCash creditado.
                  </Text>
                )}
                {purchase.reversedCentavos > 0 && (
                  <Text as="p" sx={{ m: 0 }}>
                    Estorno registrado: {formatCentavosBRL(purchase.reversedCentavos)}. Consulte o
                    atendimento para detalhes.
                  </Text>
                )}
                {['needs_review', 'held_in_case'].includes(purchase.status) && (
                  <Text as="p" sx={{ m: 0 }}>
                    Pagamento recebido e em análise financeira. O saldo ainda não foi liberado.
                  </Text>
                )}
                {purchase.paidAfterCancelAt && (
                  <Text as="p" sx={{ m: 0 }}>
                    Pagamento recebido após o cancelamento e conciliado automaticamente.
                  </Text>
                )}
                {purchase.cancelReason && (
                  <Text as="p" sx={{ m: 0 }}>
                    Motivo: {purchase.cancelReason}
                  </Text>
                )}
                <RefundSourceButton type="purchase" id={purchase.id} onCreated={onRefundCreated} />
              </Box>
            </details>
          </Box>
        )
      })}
      {hasMore && (
        <Button onClick={loadMore} disabled={loading}>
          Carregar mais compras
        </Button>
      )}
    </section>
  )
}

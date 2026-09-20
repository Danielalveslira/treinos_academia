import { useEffect, useState } from 'react'
import { Box, Button, Flash, Heading, Label, Spinner, Text } from '@primer/react'
import { SparkleFillIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useCashPurchases } from '../hooks/useCashPurchases'
import { getCashPurchaseSettings, requestCashPurchase } from '../services/cashPurchaseService'
import { CashPackageCards } from '../components/CashPackageCards'
import { CopyButton } from '../components/CopyButton'
import { PixPaymentInstructions } from '../components/PixPaymentInstructions'
import { formatCentavosBRL, formatDateTime } from '../utils/format'
import {
  resolveRequestId,
  hasPendingCashPurchase,
  abbreviateProtocol,
  USER_CASH_PURCHASE_STATUS_LABELS as STATUS_LABELS,
} from '../utils/cashPurchaseFlow'

function newRequestId() {
  // crypto.randomUUID exige contexto seguro (https/localhost) -- sempre verdadeiro no
  // app publicado, mas o fallback evita quebrar num ambiente de desenvolvimento atípico.
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// EvoCash (Fase 4): pacotes, solicitar compra, instruções de PIX e "minhas compras" --
// tudo numa página só, já que são passos do mesmo fluxo. O crédito em si só acontece
// depois de um admin confirmar o pagamento manualmente (ver AdminCashPurchases.jsx);
// esta página nunca credita nada sozinha.
export default function EvoCash() {
  const { user } = useAuth()
  const [settings, setSettings] = useState({ packages: [], pixPayment: null })
  const [loadingSettings, setLoadingSettings] = useState(true)
  // Guarda o requestId da tentativa em andamento -- reenviado se a MESMA tentativa
  // (mesmo pacote, ainda sem sucesso) for repetida, nunca gerado de novo a cada clique
  // (isso é o que torna o retry idempotente, ver cash-purchase-core.js).
  const [pendingAttempt, setPendingAttempt] = useState(null)
  const [buyingPackageId, setBuyingPackageId] = useState(null)
  const [error, setError] = useState('')
  const [lastCreated, setLastCreated] = useState(null)
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

  const hasPendingPurchase = hasPendingCashPurchase(purchases)

  async function buy(packageId) {
    if (buyingPackageId) return
    setError('')
    setBuyingPackageId(packageId)
    const requestId = resolveRequestId(pendingAttempt, packageId, newRequestId)
    try {
      const result = await requestCashPurchase({ packageId, requestId })
      setLastCreated(result)
      setPendingAttempt(null)
      await refresh()
    } catch (err) {
      setPendingAttempt({ key: packageId, requestId })
      setError(
        [
          'functions/failed-precondition',
          'functions/invalid-argument',
          'functions/already-exists',
        ].includes(err?.code)
          ? err.message
          : 'Não foi possível solicitar a compra. Tente novamente.'
      )
    } finally {
      setBuyingPackageId(null)
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

      {lastCreated && (
        <Box sx={{ mb: 3, minWidth: 0 }}>
          <Text as="p" sx={{ fontWeight: 'bold', m: 0, mb: 2 }}>
            Pedido criado
          </Text>
          {/* pixPaymentSnapshot vem do próprio pedido (gravado por requestCashPurchase no
              momento da criação), nunca de settings.pixPayment (config ao vivo) -- se a
              chave mudar depois, este pedido continua mostrando o destino de quando foi
              criado. */}
          <PixPaymentInstructions
            purchaseId={lastCreated.purchaseId}
            packageLabel={lastCreated.packageLabel}
            cashAmount={lastCreated.cashAmount}
            amountCentavos={lastCreated.amountCentavos}
            pixPayment={lastCreated.pixPaymentSnapshot}
          />
        </Box>
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
            Você já tem uma compra aguardando confirmação — acompanhe em &quot;Minhas
            compras&quot; abaixo.
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
              <Label variant={STATUS_LABELS[purchase.status]?.variant}>
                {STATUS_LABELS[purchase.status]?.text || purchase.status}
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
              Data: {formatDateTime(purchase.createdAt?.toDate())}
            </Text>

            {purchase.status === 'pending' && (
              // Mesmo raciocínio acima: pixPaymentSnapshot é o do PRÓPRIO pedido, nunca a
              // config atual -- reload/"Minhas compras" sempre mostra o destino de quando
              // o pedido foi criado, mesmo que economyConfig/current.pixPayment já tenha
              // mudado depois.
              <PixPaymentInstructions
                purchaseId={purchase.id}
                packageLabel={purchase.packageLabel}
                cashAmount={purchase.cashAmount}
                amountCentavos={purchase.amountCentavos}
                pixPayment={purchase.pixPaymentSnapshot}
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

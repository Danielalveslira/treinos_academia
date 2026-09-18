import { useEffect, useState } from 'react'
import { Box, Button, Flash, Heading, Label, Spinner, Text } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { useCashPurchases } from '../hooks/useCashPurchases'
import { getCashPurchaseSettings, requestCashPurchase } from '../services/cashPurchaseService'
import { formatCentavosBRL, formatDateTime } from '../utils/format'
import {
  resolveRequestId,
  hasPendingCashPurchase,
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
  const [settings, setSettings] = useState({ packages: [], pixKey: null })
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
        <p>Crédito premium para comunidades, destaques e recursos futuros.</p>
      </header>

      {error && (
        <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}

      {lastCreated && (
        <Flash variant="success" sx={{ mb: 3 }}>
          <Text as="p" sx={{ fontWeight: 'bold', m: 0 }}>
            Pedido criado — protocolo {lastCreated.purchaseId}
          </Text>
          <Text as="p" sx={{ m: 0 }}>
            Pague {formatCentavosBRL(lastCreated.amountCentavos)} via PIX
            {settings.pixKey ? (
              <>
                {' '}
                para a chave <strong>{settings.pixKey}</strong>
              </>
            ) : (
              ' (fale com o Atendimento para receber a chave)'
            )}{' '}
            e envie o comprovante pelo Atendimento citando o protocolo acima. Você recebe{' '}
            {lastCreated.cashAmount} EvoCash assim que a equipe confirmar o pagamento.
          </Text>
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
            Você já tem uma compra aguardando confirmação — acompanhe em &quot;Minhas
            compras&quot; abaixo.
          </Flash>
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {settings.packages.map((pkg) => (
            <Box
              key={pkg.packageId}
              sx={{
                border: '1px solid',
                borderColor: 'border.default',
                borderRadius: 2,
                p: 3,
                minWidth: 220,
              }}
            >
              <Heading as="h3" sx={{ fontSize: 1 }}>
                {pkg.label}
              </Heading>
              <Text as="p" sx={{ fontSize: 3, fontWeight: 'bold', m: 0 }}>
                {formatCentavosBRL(pkg.amountCentavos)}
              </Text>
              <Button
                variant="primary"
                sx={{ mt: 2 }}
                loading={buyingPackageId === pkg.packageId}
                disabled={!!buyingPackageId || hasPendingPurchase}
                onClick={() => buy(pkg.packageId)}
              >
                Comprar
              </Button>
            </Box>
          ))}
        </Box>
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
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: 2,
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              p: 3,
              mb: 2,
            }}
          >
            <Box>
              <Text as="p" sx={{ fontWeight: 'bold', m: 0 }}>
                {purchase.packageLabel}
              </Text>
              <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                Protocolo {purchase.id} · {formatDateTime(purchase.createdAt?.toDate())}
              </Text>
              <Text as="p" sx={{ fontSize: 0, m: 0 }}>
                {formatCentavosBRL(purchase.amountCentavos)} — {purchase.cashAmount} EvoCash
              </Text>
              {purchase.status === 'cancelled' && purchase.cancelReason && (
                <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                  Motivo: {purchase.cancelReason}
                </Text>
              )}
            </Box>
            <Label variant={STATUS_LABELS[purchase.status]?.variant}>
              {STATUS_LABELS[purchase.status]?.text || purchase.status}
            </Label>
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

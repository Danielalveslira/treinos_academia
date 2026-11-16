import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Box, Button, Flash, Heading, Text } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { useCashPurchases } from '../hooks/useCashPurchases'
import { useWallet } from '../hooks/useWallet'
import { cancelMyCashPurchase, checkInfinitepayPurchase } from '../services/cashPurchaseService'
import { RefundPolicyNotice, RefundRequestsPanel } from '../components/Refunds'
import { EvoCashQuantityPurchase } from '../components/EvoCashQuantityPurchase'
import { EvoCashPurchaseHistory } from '../components/EvoCashPurchaseHistory'
import { hasPendingCashPurchase } from '../utils/cashPurchaseFlow'
import './EvoCash.css'

// O crédito é confirmado no backend; esta página somente consulta o retorno do checkout.
export default function EvoCash() {
  const { user } = useAuth()
  const {
    display,
    loading: walletLoading,
    error: walletError,
    refresh: refreshWallet,
  } = useWallet()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState(
    searchParams.has('request') || searchParams.get('checkout_return') === '1' ? 'history' : 'buy'
  )
  const [section, setSection] = useState(searchParams.has('request') ? 'requests' : 'purchases')
  const [focusedPurchaseId, setFocusedPurchaseId] = useState(searchParams.get('purchase_id'))
  const [cancellingPurchaseId, setCancellingPurchaseId] = useState(null)
  const [error, setError] = useState('')
  const [refundRevision, setRefundRevision] = useState(0)
  const [policySnapshot, setPolicySnapshot] = useState(null)
  const [checkoutReturn, setCheckoutReturn] = useState(null)
  const {
    purchases,
    pendingPurchase,
    loading,
    hasMore,
    loadMore,
    error: listError,
    refresh,
  } = useCashPurchases(user?.uid)

  useEffect(() => setPolicySnapshot(null), [user?.uid])

  useEffect(() => {
    if (searchParams.has('request')) {
      setTab('history')
      setSection('requests')
    }
  }, [searchParams])

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
    setTab('history')
    setSection('purchases')
    setFocusedPurchaseId(purchaseId)
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
        if (result.status === 'credited') {
          refreshWallet()
          setSearchParams({}, { replace: true })
        }
      })
      .catch(() => {
        if (active) setCheckoutReturn('pending')
      })
    return () => {
      active = false
    }
  }, [searchParams, setSearchParams, refresh, refreshWallet])

  useEffect(() => {
    if (checkoutReturn !== 'pending') return
    const purchaseId = searchParams.get('purchase_id')
    if (
      purchases.some((purchase) => purchase.id === purchaseId && purchase.status === 'credited')
    ) {
      refreshWallet()
      setCheckoutReturn('credited')
      setSearchParams({}, { replace: true })
    }
  }, [checkoutReturn, purchases, searchParams, setSearchParams, refreshWallet])

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

  function showPending() {
    setTab('history')
    setSection('purchases')
    setFocusedPurchaseId(pendingPurchase?.id)
  }

  function selectTab(next) {
    setTab(next)
    setSection('purchases')
  }

  function handleTabKeys(event) {
    const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')]
    const selected = tabs.indexOf(document.activeElement)
    let next = selected
    if (event.key === 'ArrowRight') next = (selected + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (selected - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    tabs[next]?.focus()
    tabs[next]?.click()
  }

  return (
    <div className="profile-page evocash-page">
      <header className="profile-page-heading">
        <span className="profile-eyebrow">EVOCASH</span>
        <h1>Comprar EvoCash</h1>
        <p>Créditos para contratar serviços no Evolutus</p>
        <Link to="/entenda-suas-moedas">Entenda EvoCash e EvoCoins</Link>
      </header>
      <Box sx={{ p: 3, bg: 'canvas.subtle', borderRadius: 2, mb: 3 }} aria-live="polite">
        <Text as="p" sx={{ m: 0, color: 'fg.muted' }}>
          Saldo disponível
        </Text>
        <Text as="p" sx={{ m: 0, fontSize: 4, fontWeight: 'bold' }}>
          {walletLoading || walletError || !display || display.source !== 'server'
            ? 'Atualizando saldo'
            : `${display.cashBalance} EvoCash`}
        </Text>
      </Box>
      {error && (
        <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}
      {checkoutReturn && (
        <Flash sx={{ mb: 3 }} role="status">
          {checkoutReturn === 'checking'
            ? 'Conferindo seu pagamento…'
            : checkoutReturn === 'credited'
              ? 'Pagamento confirmado. Consulte seu saldo atualizado.'
              : checkoutReturn === 'review'
                ? 'Pagamento recebido e em análise financeira. O saldo ainda não foi liberado.'
                : 'Pagamento ainda não confirmado. Acompanhe no Histórico.'}
        </Flash>
      )}
      <div className="evocash-tabs" role="tablist" aria-label="EvoCash" onKeyDown={handleTabKeys}>
        <button
          role="tab"
          id="evocash-buy-tab"
          aria-selected={tab === 'buy'}
          aria-controls="evocash-buy-panel"
          tabIndex={tab === 'buy' ? 0 : -1}
          onClick={() => selectTab('buy')}
        >
          Comprar
        </button>
        <button
          role="tab"
          id="evocash-history-tab"
          aria-selected={tab === 'history'}
          aria-controls="evocash-history-panel"
          tabIndex={tab === 'history' ? 0 : -1}
          onClick={() => selectTab('history')}
        >
          Histórico
        </button>
      </div>
      {tab === 'buy' ? (
        <section id="evocash-buy-panel" role="tabpanel" aria-labelledby="evocash-buy-tab">
          {listError && (
            <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
              Não foi possível conferir suas compras em andamento.{' '}
              <Button onClick={refresh}>Tentar novamente</Button>
            </Flash>
          )}
          {pendingPurchase && (
            <Flash variant="attention" sx={{ mb: 3 }}>
              {pendingPurchase.checkoutUncertain
                ? 'Sua compra está em conciliação.'
                : pendingPurchase.checkoutUrl
                  ? 'Você tem uma compra aguardando pagamento ou confirmação.'
                  : 'Seu pagamento está sendo preparado.'}{' '}
              <Button onClick={showPending}>Ver compra em andamento</Button>
            </Flash>
          )}
          <EvoCashQuantityPurchase
            key={user?.uid}
            userId={user?.uid}
            hasPendingPurchase={
              loading || !!listError || !!pendingPurchase || hasPendingCashPurchase(purchases)
            }
            onPurchaseChanged={refresh}
            onPolicySnapshot={setPolicySnapshot}
          />
          <RefundPolicyNotice snapshot={policySnapshot} purchase />
        </section>
      ) : (
        <section id="evocash-history-panel" role="tabpanel" aria-labelledby="evocash-history-tab">
          <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
            Histórico
          </Heading>
          <div
            className="evocash-tabs evocash-subtabs"
            role="tablist"
            aria-label="Tipo de histórico"
            onKeyDown={handleTabKeys}
          >
            <button
              role="tab"
              id="evocash-purchases-tab"
              aria-selected={section === 'purchases'}
              aria-controls="evocash-purchases-panel"
              tabIndex={section === 'purchases' ? 0 : -1}
              onClick={() => setSection('purchases')}
            >
              Compras
            </button>
            <button
              role="tab"
              id="evocash-requests-tab"
              aria-selected={section === 'requests'}
              aria-controls="evocash-requests-panel"
              tabIndex={section === 'requests' ? 0 : -1}
              onClick={() => setSection('requests')}
            >
              Solicitações
            </button>
          </div>
          {section === 'purchases' ? (
            <div
              id="evocash-purchases-panel"
              role="tabpanel"
              aria-labelledby="evocash-purchases-tab"
            >
              <EvoCashPurchaseHistory
                purchases={purchases}
                pendingPurchase={pendingPurchase}
                loading={loading}
                error={listError}
                hasMore={hasMore}
                loadMore={loadMore}
                refresh={refresh}
                cancellingPurchaseId={cancellingPurchaseId}
                cancelPurchase={cancelPurchase}
                focusedPurchaseId={focusedPurchaseId}
                onRefundCreated={(created) => {
                  setRefundRevision((value) => value + 1)
                  setSection('requests')
                  if (created?.id) {
                    setSearchParams((current) => {
                      const next = new URLSearchParams(current)
                      next.set('request', created.id)
                      return next
                    })
                  }
                }}
              />
            </div>
          ) : (
            <div id="evocash-requests-panel" role="tabpanel" aria-labelledby="evocash-requests-tab">
              <RefundRequestsPanel
                compact
                initialId={searchParams.get('request')}
                revision={refundRevision}
              />
            </div>
          )}
        </section>
      )}
    </div>
  )
}

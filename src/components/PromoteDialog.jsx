import { useEffect, useReducer } from 'react'
import { Box, Button, Dialog, Flash, Spinner, Text } from '@primer/react'
import { getWallet } from '../services/economyService'
import { createPromotion, getPromotionPackages } from '../services/promotionsService'
import { resolveRequestId } from '../utils/cashPurchaseFlow'

// Fase 6 (promoções pagas com EvoCash) -- pacote fixo, duração fixa, sem CPC/CPM/
// leilão. Mesmo fluxo idempotente de EvoCash.jsx/CreateCommunity.jsx
// (resolveRequestId): um retry depois de uma falha reenvia o MESMO requestId, nunca
// debita duas vezes (a garantia real está no servidor, ver promotion-service.js -- isto
// é só a UI). Estado extraído como reducer puro (mesmo motivo de EconomyVotersDialog:
// testável sem depender de act()/TestRenderer).
export function initialPromoteDialogState() {
  return {
    packages: [],
    loadingPackages: true,
    selectedPackageId: null,
    walletBalance: null,
    submitting: false,
    error: '',
    pendingAttempt: null,
    result: null,
  }
}

export function promoteDialogReducer(state, action) {
  switch (action.type) {
    case 'packages_loaded':
      return {
        ...state,
        packages: action.packages,
        loadingPackages: false,
        selectedPackageId: state.selectedPackageId ?? action.packages[0]?.packageId ?? null,
      }
    case 'wallet_loaded':
      return { ...state, walletBalance: action.balance }
    case 'select_package':
      return { ...state, selectedPackageId: action.packageId }
    case 'submit_start':
      return { ...state, submitting: true, error: '' }
    case 'submit_success':
      return { ...state, submitting: false, result: action.result, pendingAttempt: null }
    case 'submit_error':
      return { ...state, submitting: false, error: action.message, pendingAttempt: action.pendingAttempt }
    default:
      return state
  }
}

function newRequestId() {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function PromoteDialogBody({ targetType, targetId, currentUserId, onPromoted }) {
  const [state, dispatch] = useReducer(promoteDialogReducer, undefined, initialPromoteDialogState)
  const { packages, loadingPackages, selectedPackageId, walletBalance, submitting, error, pendingAttempt, result } =
    state

  useEffect(() => {
    let active = true
    getPromotionPackages(targetType).then((loaded) => {
      if (active) dispatch({ type: 'packages_loaded', packages: loaded })
    })
    getWallet(currentUserId).then((wallet) => {
      if (active) dispatch({ type: 'wallet_loaded', balance: wallet.cashBalance })
    })
    return () => {
      active = false
    }
  }, [targetType, currentUserId])

  async function promote() {
    if (submitting || !selectedPackageId) return
    const requestId = resolveRequestId(pendingAttempt, selectedPackageId, newRequestId)
    dispatch({ type: 'submit_start' })
    try {
      const promotionResult = await createPromotion({ targetType, targetId, packageId: selectedPackageId, requestId })
      dispatch({ type: 'submit_success', result: promotionResult })
      onPromoted?.(promotionResult)
    } catch (err) {
      dispatch({
        type: 'submit_error',
        pendingAttempt: { key: selectedPackageId, requestId },
        message:
          ['functions/failed-precondition', 'functions/invalid-argument', 'functions/permission-denied'].includes(
            err?.code
          )
            ? err.message
            : 'Não foi possível criar a promoção. Tente novamente.',
      })
    }
  }

  if (result) {
    return (
      <Flash variant="success">
        Promoção ativada! Válida por {result.durationDays} {result.durationDays === 1 ? 'dia' : 'dias'}.
      </Flash>
    )
  }

  if (loadingPackages) return <Spinner aria-label="Carregando pacotes" />

  const selectedPackage = packages.find((pkg) => pkg.packageId === selectedPackageId)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {walletBalance != null && (
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>Saldo atual: {walletBalance} EvoCash</Text>
      )}
      {error && (
        <Text as="p" role="alert" sx={{ color: 'danger.fg', fontSize: 0, m: 0 }}>
          {error}
        </Text>
      )}
      {packages.length === 0 && (
        <Text sx={{ color: 'fg.muted' }}>Nenhum pacote de promoção disponível no momento.</Text>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {packages.map((pkg) => (
          <Button
            key={pkg.packageId}
            data-testid={`promo-package-${pkg.packageId}`}
            variant={pkg.packageId === selectedPackageId ? 'primary' : 'default'}
            aria-pressed={pkg.packageId === selectedPackageId}
            block
            onClick={() => dispatch({ type: 'select_package', packageId: pkg.packageId })}
          >
            {pkg.label} -- {pkg.cashAmount} EvoCash
          </Button>
        ))}
      </Box>
      {selectedPackage && (
        <Button
          variant="primary"
          block
          loading={submitting}
          disabled={packages.length === 0}
          onClick={promote}
        >
          Promover por {selectedPackage.cashAmount} EvoCash
        </Button>
      )}
    </Box>
  )
}

export function PromoteDialog({ targetType, targetId, currentUserId, title, onClose, onPromoted }) {
  return (
    <Dialog
      title={title || 'Promover'}
      subtitle="Pacote fixo, duração fixa -- pago com EvoCash"
      onClose={onClose}
      width="medium"
    >
      <PromoteDialogBody
        targetType={targetType}
        targetId={targetId}
        currentUserId={currentUserId}
        onPromoted={onPromoted}
      />
    </Dialog>
  )
}

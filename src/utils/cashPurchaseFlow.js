// EvoCash (Fase 4) -- lógica pura extraída de EvoCash.jsx/AdminCashPurchases.jsx para
// ser testável sem renderizar nada (mesmo espírito de exerciseOrder.js): decisões de
// UI que não dependem de chamadas de rede, só de dados já em mãos.

// requestId reaproveitado enquanto a MESMA tentativa (mesma "chave" -- um packageId, ou
// os valores do formulário serializados em CreateCommunity.jsx, ainda sem sucesso) está
// em andamento -- gerar um novo a cada clique quebraria a idempotência do lado do
// servidor (ver cash-purchase-core.js: cashPurchaseIdFromRequest/
// createCommunityIdFromRequest). Uma chave diferente (ou nenhuma tentativa pendente)
// sempre gera um requestId novo -- são intenções distintas, nunca deveriam colidir no
// mesmo purchaseId/communityId. Genérica de propósito (campo `key`, não `packageId`):
// reaproveitada tanto por EvoCash.jsx quanto por CreateCommunity.jsx.
export function resolveRequestId(pendingAttempt, key, generateId) {
  return pendingAttempt?.key === key ? pendingAttempt.requestId : generateId()
}

// Usado para desabilitar o botão "Comprar" -- puramente uma conveniência de UX (o
// backend já impede uma segunda compra pending via cashPurchaseLock, ver
// cash-purchase-service.js); esta checagem só evita o clique que sabidamente falharia.
export function hasPendingCashPurchase(purchases) {
  return purchases.some((purchase) => purchase.status === 'pending' &&
    (purchase.paymentProvider !== 'infinitepay' || !!purchase.checkoutUrl))
}

export function cashPurchaseStatusLabel(purchase, labels) {
  if (purchase.paymentProvider === 'infinitepay' && purchase.status === 'pending' && !purchase.checkoutUrl) {
    return purchase.checkoutUncertain
      ? { text: 'Checkout em conciliação', variant: 'attention' }
      : { text: 'Preparando checkout', variant: 'attention' }
  }
  return labels[purchase.status] || { text: purchase.status, variant: 'default' }
}

export function openInfinitepayCheckout(value, navigate = (url) => window.location.assign(url)) {
  let url
  try { url = new URL(value) } catch { throw new Error('INVALID_CHECKOUT_URL') }
  if (url.protocol !== 'https:' ||
      !['checkout.infinitepay.io', 'checkout.infinitepay.com.br'].includes(url.hostname) ||
      url.username || url.password || url.port) throw new Error('INVALID_CHECKOUT_URL')
  navigate(url.toString())
}

// Também usado pela tela de cancelamento de promoções.
export function canSubmitCancellation(reason) {
  return typeof reason === 'string' && reason.trim().length >= 5
}

// Uma entrada por status realmente alcançável, inclusive retenção em caso financeiro. Textos
// diferentes para a mesma compra dependendo de quem olha (usuário vê "aguardando
// confirmação"; admin vê "pendente") -- diferença de público, não duplicação por acaso.
export const USER_CASH_PURCHASE_STATUS_LABELS = {
  pending: { text: 'Aguardando confirmação', variant: 'attention' },
  credited: { text: 'Creditado', variant: 'success' },
  cancelled: { text: 'Cancelado', variant: 'danger' },
  checkout_failed: { text: 'Checkout não iniciado', variant: 'danger' },
  held_in_case: { text: 'Retido em análise financeira', variant: 'attention' },
}

export const ADMIN_CASH_PURCHASE_STATUS_LABELS = {
  pending: { text: 'Pendente', variant: 'attention' },
  credited: { text: 'Creditada', variant: 'success' },
  cancelled: { text: 'Cancelada', variant: 'danger' },
  checkout_failed: { text: 'Falha no checkout', variant: 'danger' },
  held_in_case: { text: 'Retida em caso financeiro', variant: 'attention' },
}

// Abrevia só a APRESENTAÇÃO de um protocolo (uuid, 36 caracteres) pra não estourar a
// largura do card no mobile -- nunca usado pelo valor que é efetivamente copiado ou
// enviado a qualquer RPC, só pelo texto exibido na tela.
export function abbreviateProtocol(value, { prefixLength = 8, suffixLength = 7 } = {}) {
  if (typeof value !== 'string') return value
  if (value.length <= prefixLength + suffixLength) return value
  return `${value.slice(0, prefixLength)}…${value.slice(-suffixLength)}`
}

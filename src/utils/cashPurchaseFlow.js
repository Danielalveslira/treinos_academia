// EvoCash (Fase 4) -- lógica pura extraída de EvoCash.jsx/AdminCashPurchases.jsx para
// ser testável sem renderizar nada (mesmo espírito de exerciseOrder.js): decisões de
// UI que não dependem de Firestore/callable, só de dados já em mãos.

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
  return purchases.some((purchase) => purchase.status === 'pending')
}

// Mesmo limite mínimo de 5 caracteres que cancelCashPurchase exige no servidor -- aqui
// só desabilita o botão antes de gastar uma chamada que sabidamente falharia.
export function canSubmitCancellation(reason) {
  return typeof reason === 'string' && reason.trim().length >= 5
}

// Uma entrada por status realmente alcançável (pending/credited/cancelled, ver
// cash-purchase-core.js: são os 2 únicos estados terminais + o inicial). Textos
// diferentes para a mesma compra dependendo de quem olha (usuário vê "aguardando
// confirmação"; admin vê "pendente") -- diferença de público, não duplicação por acaso.
export const USER_CASH_PURCHASE_STATUS_LABELS = {
  pending: { text: 'Aguardando confirmação', variant: 'attention' },
  credited: { text: 'Creditado', variant: 'success' },
  cancelled: { text: 'Cancelado', variant: 'danger' },
}

export const ADMIN_CASH_PURCHASE_STATUS_LABELS = {
  pending: { text: 'Pendente', variant: 'attention' },
  credited: { text: 'Creditada', variant: 'success' },
  cancelled: { text: 'Cancelada', variant: 'danger' },
}

const PIX_KEY_TYPE_LABELS = {
  email: 'E-mail',
  phone: 'Telefone',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  random: 'Chave aleatória',
}

// pixPayment.keyType já vem validado pelo backend (ver isValidPixPayment em
// cash-purchase-core.js) antes de qualquer pedido poder ser criado -- o fallback aqui é
// só defesa de exibição (nunca deveria disparar na prática).
export function resolvePixKeyTypeLabel(keyType) {
  return PIX_KEY_TYPE_LABELS[keyType] || 'Chave PIX'
}

// /admin/compras-evocash tem duas abas (Pedidos/Configuração PIX), selecionadas via
// ?tab= na própria URL -- refresh/compartilhar o link mantém a aba aberta. Qualquer
// valor desconhecido ou ausente cai em "pedidos" (a aba padrão), nunca quebra a tela.
export const CASH_PURCHASES_ADMIN_TABS = ['pedidos', 'pix']

export function normalizeCashPurchasesAdminTab(value) {
  return CASH_PURCHASES_ADMIN_TABS.includes(value) ? value : 'pedidos'
}

// Abrevia só a APRESENTAÇÃO de um protocolo (sha256 hex, sempre 64 caracteres) pra não
// estourar a largura do card no mobile -- nunca usado pelo valor que é efetivamente
// copiado ou enviado a qualquer callable, só pelo texto exibido na tela.
export function abbreviateProtocol(value, { prefixLength = 8, suffixLength = 7 } = {}) {
  if (typeof value !== 'string') return value
  if (value.length <= prefixLength + suffixLength) return value
  return `${value.slice(0, prefixLength)}…${value.slice(-suffixLength)}`
}

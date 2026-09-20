import { randomUUID } from 'node:crypto'

// Administração de chaves PIX (aba "Configuração PIX" de /admin/compras-evocash):
// validação pura + montagem da projeção pública, sem nenhum acesso a Firestore. Mantido
// separado de cash-purchase-core.js -- este módulo valida os CAMPOS de uma chave em
// cadastro (sem "enabled", que é um estado global, não por chave); cash-purchase-core.js
// valida a config JÁ PUBLICADA (com "enabled") que requestCashPurchase lê.
// VALID_PIX_KEY_TYPES é intencionalmente duplicado ali em vez de importado daqui -- evita
// acoplar um módulo já testado/em produção a este, novo.
const VALID_PIX_KEY_TYPES = new Set(['email', 'phone', 'cpf', 'cnpj', 'random'])

export function isValidPixMethodFields(fields) {
  if (fields == null || typeof fields !== 'object') return false
  const { key, keyType, recipientName } = fields
  return (
    typeof key === 'string' &&
    key.trim().length > 0 &&
    key.length <= 200 &&
    VALID_PIX_KEY_TYPES.has(keyType) &&
    typeof recipientName === 'string' &&
    recipientName.trim().length > 0 &&
    recipientName.length <= 140
  )
}

export function isValidPixMethodLabel(label) {
  return typeof label === 'string' && label.trim().length > 0 && label.length <= 80
}

// pix_ + UUID: nunca reaproveitado, nunca previsível -- mesmo espírito de
// cashPurchaseIdFromRequest (mas aqui não precisa ser determinístico, cada clique em
// "Adicionar chave" é sempre uma chave nova).
export function generatePixMethodId() {
  return `pix_${randomUUID()}`
}

// Formato exato que requestCashPurchase já espera em economyConfig/current.pixPayment
// (ver isValidPixPayment em cash-purchase-core.js) -- nunca inclui label/createdAt/
// updatedAt (metadados administrativos, irrelevantes pro comprador e pro backend de
// compra). Enquanto os pagamentos estiverem desativados (enabled !== true), a projeção
// NUNCA carrega key/keyType/recipientName -- só {enabled:false}. A chave continua
// intacta em privatePaymentConfig/pix (server-only); simplesmente não faz sentido expor
// o destino de um PIX pra qualquer usuário autenticado enquanto ele nem pode ser usado.
// Quem grava isto SEMPRE via tx.update() (nunca set com merge:true) -- economyConfig/
// current.pixPayment é um mapa aninhado, e merge:true faz merge recursivo em mapas
// aninhados (mesmo comportamento já comprovado com cashPackages): trocar de {enabled,
// key, keyType, recipientName} pra {enabled:false} via merge deixaria key/keyType/
// recipientName antigos sobrevivendo. update() substitui o campo pixPayment por inteiro.
export function buildPublicPixPaymentProjection(enabled, method) {
  if (enabled !== true) return { enabled: false }
  return {
    enabled: true,
    key: method.key,
    keyType: method.keyType,
    recipientName: method.recipientName,
  }
}

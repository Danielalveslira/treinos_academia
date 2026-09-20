import { toMillis } from './expiry.js'

// Fase 6 -- rótulo de status é sempre DERIVADO na leitura, nunca um valor gravado: o
// documento de promotions/{id} nunca vira 'expired' sozinho (não existe scheduler, ver
// isPromotionCurrentlyActive em functions/economy/promotion-core.js), então "expirada"
// só existe aqui, calculada a partir de status:'active' + expiresAt no passado. Puro
// (sem I/O) para ser testável sem depender de Firestore/rendering.
export function derivePromotionStatus(promotion, nowMs) {
  if (promotion.status === 'cancelled') return 'cancelled'
  if (promotion.status === 'target_removed') return 'target_removed'
  return toMillis(promotion.expiresAt) > nowMs ? 'active' : 'expired'
}

export const PROMOTION_STATUS_LABELS = {
  active: { text: 'Ativa', variant: 'success' },
  expired: { text: 'Expirada', variant: 'default' },
  cancelled: { text: 'Cancelada', variant: 'attention' },
  target_removed: { text: 'Alvo removido', variant: 'danger' },
}

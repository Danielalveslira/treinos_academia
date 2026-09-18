import { createHash } from 'node:crypto'

// Fase 4 (EvoCash): o ID do pedido é derivado de uid+requestId, nunca um auto-id --
// requestId é gerado UMA VEZ pelo frontend e reenviado em qualquer retry/timeout do
// mesmo clique. Duas chamadas com o mesmo requestId batem no MESMO documento
// (tx.get/tx.create do mesmo ref), o que dá idempotência real via a serialização de
// transação do Firestore (mesmo mecanismo já usado em ledgerNaturalKeyHash), sem
// depender de nenhuma query.
export function cashPurchaseIdFromRequest(uid, requestId) {
  return createHash('sha256').update(`${uid}:${requestId}`).digest('hex')
}

function isSafePositiveInteger(value, max) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max
}

// Dinheiro real: Number.isSafeInteger (não só isInteger) e sempre em centavos, nunca
// float de reais. Validado localmente aqui -- de propósito NUNCA integrado ao mecanismo
// de fallback de config-service.js (DEFAULT_ECONOMY_CONFIG não tem cashPackages): config
// ausente ou pacote malformado precisa BLOQUEAR a compra, nunca cair num preço padrão.
export function isValidCashPackage(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    isSafePositiveInteger(value.cashAmount, 1_000_000) &&
    isSafePositiveInteger(value.amountCentavos, 10_000_000) &&
    typeof value.label === 'string' &&
    value.label.trim().length > 0 &&
    value.label.length <= 80
  )
}

// Revalidação defensiva do snapshot já gravado, feita de novo em confirmCashPurchase
// antes de creditar -- nunca confia cegamente num documento só porque já existe e está
// 'pending' (edição manual, migração futura, corrupção). Reaproveita isValidCashPackage
// para os 3 campos que compartilham a mesma forma (cashAmount/amountCentavos/label).
export function isValidPurchaseSnapshot(data) {
  return (
    data != null &&
    typeof data.userId === 'string' &&
    data.userId.length > 0 &&
    data.currency === 'BRL' &&
    isValidCashPackage({
      cashAmount: data.cashAmount,
      amountCentavos: data.amountCentavos,
      label: data.packageLabel,
    })
  )
}

// Único ponto de decisão sobre o que bloqueia a exclusão de conta por motivo
// financeiro -- usado tanto pelo portão em deletion-service.js (lendo o lock +
// wallet.cashBalance de verdade) quanto por confirmCashPurchase/cancelCashPurchase
// (decidindo se podem reabrir um job já bloqueado, com os valores HIPOTÉTICOS que vão
// resultar da própria escrita em curso). Uma compra pending pesa mais que saldo --
// ordem não muda o resultado final (os dois bloqueiam do mesmo jeito), só a mensagem/
// motivo relatado.
export function financialBlockReason({ pendingPurchaseId, cashBalance }) {
  if (pendingPurchaseId) return 'pending_cash_purchase'
  if (typeof cashBalance === 'number' && cashBalance > 0) return 'positive_cash_balance'
  return null
}

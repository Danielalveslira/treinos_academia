import { createHash } from 'node:crypto'

// Fase 6 (promoções pagas com EvoCash) -- mesmo mecanismo de idempotência de
// cash-purchase-core.js/privilege-core.js: o ID da promoção é derivado de
// uid+requestId, nunca um auto-id. Duas chamadas com o mesmo requestId batem no MESMO
// documento, e o Firestore serializa a disputa -- sem isso, um duplo clique poderia
// debitar EvoCash duas vezes para a "mesma" promoção.
export function createPromotionIdFromRequest(uid, requestId) {
  return createHash('sha256').update(`promotion:${uid}:${requestId}`).digest('hex')
}

export const PROMOTION_TARGET_TYPES = ['post', 'community']

function isSafePositiveInteger(value, max) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max
}

// Dinheiro real (EvoCash): mesma disciplina de isValidCashPackage/
// isValidCreateCommunityPrivilege -- Number.isSafeInteger, nunca um fallback embutido.
// `active` é checado à parte por quem chama (mesma separação de isValidCashPackage: o
// "pacote existe e está bem formado" é uma pergunta, "está disponível agora" é outra).
export function isValidPromotionPackage(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    PROMOTION_TARGET_TYPES.includes(value.targetType) &&
    isSafePositiveInteger(value.cashAmount, 1_000_000) &&
    isSafePositiveInteger(value.durationDays, 90) &&
    typeof value.label === 'string' &&
    value.label.trim().length > 0 &&
    value.label.length <= 80
  )
}

// Replay do mesmo requestId precisa devolver a MESMA promoção só se o payload bater --
// reenviar o mesmo requestId com um targetId/packageId diferente é um conflito, nunca
// devolve silenciosamente uma promoção diferente da pedida (mesmo raciocínio de
// communityCreationInputMatches/cash-purchase-service.js).
export function promotionInputMatches(existing, { targetType, targetId, packageId }) {
  return existing.targetType === targetType && existing.targetId === targetId && existing.packageId === packageId
}

// Único ponto de decisão de bloqueio -- puro, sem I/O, retorna o PRIMEIRO motivo (nunca
// uma lista), mesmo padrão de createCommunityEligibilityReason (privilege-core.js) e
// resolvePostAccessDenialReason (vote-query-service.js). Quem chama já leu tudo que
// precisa (target, config, carteira, restrições) antes de chegar aqui.
export function resolvePromotionBlockReason({
  targetExists,
  isOwner,
  accountStatus,
  accountRestriction,
  nowMs,
  isCurrentMember,
  communityMembershipRestrictionExists,
  communityDeletionJobExists,
  communityIsActive,
  targetAlreadyPromoted,
  packageValid,
  packageTargetTypeMatches,
  cashBalance,
  cashCost,
}) {
  if (!targetExists) return 'target_not_found'
  if (!isOwner) return 'not_owner'
  if (accountStatus === 'disabled') return 'account_disabled'
  if (accountRestriction) {
    const suspensionExpired =
      accountRestriction.action === 'temporary_suspension' &&
      typeof accountRestriction.untilMs === 'number' &&
      accountRestriction.untilMs <= nowMs
    if (!suspensionExpired) return 'account_restricted'
  }
  // Um autor que saiu da comunidade (ou de um post) ou foi banido dela não pode
  // promover um post antigo só porque authorId ainda bate -- mesma checagem de
  // acesso que voteOnPost já faz (communityMembers + communityRestrictions),
  // aplicada aqui tanto pra post quanto pra comunidade (o dono de uma comunidade
  // sempre ganha membership própria na criação, ver privilege-service.js, então isto
  // nunca bloqueia o caso comum -- só o caso de banimento/saída real).
  if (!isCurrentMember) return 'not_a_member'
  if (communityMembershipRestrictionExists) return 'community_restricted'
  if (communityDeletionJobExists) return 'community_unavailable'
  if (communityIsActive === false) return 'community_unavailable'
  if (targetAlreadyPromoted) return 'already_promoted'
  if (!packageValid || !packageTargetTypeMatches) return 'invalid_package'
  if (cashBalance < cashCost) return 'insufficient_cash'
  return null
}

// "Ver quem votou" já provou que denormalizar (promoted/promotedUntil) evita ler
// promotions/{id} pra decidir o que exibir/destacar -- mas pra REGISTRAR uma métrica
// (recordPromotionEvent) o cliente precisa saber QUAL promoção incrementar, e não há
// como derivar isso sem guardar o próprio ID no alvo (activePromotionId). Estas duas
// funções puras cobrem a revalidação exigida antes de incrementar: a promoção
// realmente pertence a este alvo, e ainda está ativa (nunca confia em status:'active'
// isoladamente -- ele nunca vira 'expired' sozinho, ver isTargetCurrentlyPromoted).
export function promotionMatchesTarget(promotion, { targetType, targetId }) {
  return promotion?.targetType === targetType && promotion?.targetId === targetId
}

export function isPromotionCurrentlyActive(promotion, nowMs) {
  return (
    promotion?.status === 'active' &&
    typeof promotion?.expiresAtMs === 'number' &&
    promotion.expiresAtMs > nowMs
  )
}

// startedAt/expiresAt SEMPRE derivados do mesmo nowMs (nunca FieldValue.serverTimestamp()
// pra um e Date.now() pra outro -- os dois teriam que resolver pro mesmo instante, e um
// sentinel só resolve no commit, não dá pra fazer aritmética em cima dele antes disso).
export function computePromotionExpiryMs(nowMs, durationDays) {
  return nowMs + durationDays * 86400000
}

// "já promovido" olha só os campos denormalizados no próprio alvo (promoted/
// promotedUntil) -- nunca uma consulta extra em promotions/, e nunca depende do campo
// `status` do documento de promoção (que nunca é virado 'expired' automaticamente,
// mesmo raciocínio de sponsoredAds.isExpired: puramente derivado na leitura).
export function isTargetCurrentlyPromoted(target, nowMs) {
  return Boolean(target?.promoted) && typeof target?.promotedUntilMs === 'number' && target.promotedUntilMs > nowMs
}

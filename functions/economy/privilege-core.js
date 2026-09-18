import { createHash } from 'node:crypto'

// Fase 5 (privilégios com EvoCash) -- mesmo mecanismo de idempotência de
// cash-purchase-core.js: o ID da comunidade é derivado de uid+requestId, nunca um
// auto-id. Duas chamadas com o mesmo requestId batem no MESMO documento, e o Firestore
// serializa a disputa -- sem isso, um duplo clique poderia debitar EvoCash duas vezes
// para duas comunidades "iguais".
export function createCommunityIdFromRequest(uid, requestId) {
  return createHash('sha256').update(`community:${uid}:${requestId}`).digest('hex')
}

// Mesma lista de src/constants/communityIcons.js -- Rules não importam JS, Functions
// não importam de src/ (build separado), então esta cópia é mantida em sincronia
// manualmente, igual à cópia já existente em firestore.rules.
export const COMMUNITY_ICON_NAMES = [
  'users', 'dumbbell', 'heart-pulse', 'flame', 'trophy', 'target',
  'zap', 'star', 'rocket', 'mountain', 'bike', 'footprints',
]

function isNonEmptyTrimmed(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
}

// Espelha validateCommunity (src/utils/validators.js) + isValidCommunity
// (firestore.rules) -- necessário aqui porque createCommunityWithCash escreve via Admin
// SDK, que nunca passa pelas Rules do cliente.
export function isValidCommunityCreationInput({ name, description, iconName }) {
  return (
    isNonEmptyTrimmed(name, 60) &&
    (description == null || description === '' || (typeof description === 'string' && description.trim().length <= 300)) &&
    typeof iconName === 'string' &&
    COMMUNITY_ICON_NAMES.includes(iconName)
  )
}

// Replay do mesmo requestId precisa devolver a MESMA comunidade só se o payload bater --
// reenviar o mesmo requestId com um nome diferente é um conflito, não uma repetição
// legítima (mesmo raciocínio de cash-purchase-service.js: nunca devolve silenciosamente
// um resultado diferente do que foi pedido).
export function communityCreationInputMatches(existing, { name, description, iconName }) {
  return (
    existing.name === name.trim() &&
    (existing.description || '') === (description?.trim() || '') &&
    existing.iconName === iconName
  )
}

function isSafeNonNegativeInteger(value, max) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
}

// Fail-closed (seção 7 do prompt de economia + já sinalizado no comentário de
// config-service.js sobre "Fase 4+"): este bloco envolve dinheiro real (cashCost) e uma
// checagem de reputação -- ausente ou corrompido precisa BLOQUEAR a criação, nunca cair
// num default embutido. Nunca integrado ao mecanismo de fallback de
// DEFAULT_ECONOMY_CONFIG, mesma decisão já tomada para cashPackages na Fase 4.
export function isValidCreateCommunityPrivilege(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    isSafeNonNegativeInteger(value.minimumLifetimeCoins, 1_000_000) &&
    isSafeNonNegativeInteger(value.minimumAccountAgeDays, 3650) &&
    typeof value.requireEmailVerified === 'boolean' &&
    isSafeNonNegativeInteger(value.cashCost, 1_000_000)
  )
}

// Único ponto de decisão sobre elegibilidade -- puro, sem I/O, para ser testável sem o
// emulador. Retorna o PRIMEIRO motivo de bloqueio (nunca uma lista): a mensagem de erro
// é sempre específica, nunca um "requisitos não atendidos" genérico.
export function createCommunityEligibilityReason({
  accountStatus,
  restriction,
  accountCreatedAtMs,
  emailVerified,
  lifetimeCoinsEarned,
  cashBalance,
  privilege,
  nowMs,
}) {
  if (accountStatus === 'disabled') return 'account_disabled'
  if (restriction && !(restriction.action === 'temporary_suspension' && restriction.until <= nowMs)) {
    return 'account_restricted'
  }
  const accountAgeDays = (nowMs - accountCreatedAtMs) / 86400000
  if (accountAgeDays < privilege.minimumAccountAgeDays) return 'account_too_new'
  if (privilege.requireEmailVerified && emailVerified !== true) return 'email_not_verified'
  if (lifetimeCoinsEarned < privilege.minimumLifetimeCoins) return 'insufficient_reputation'
  if (cashBalance < privilege.cashCost) return 'insufficient_cash'
  return null
}

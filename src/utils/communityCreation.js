// Criação de comunidades -- lógica pura da UI (testável sem renderizar nada).
//
// Tudo aqui é APRESENTAÇÃO. Quem decide elegibilidade, preço, saldo, tier e retenção é
// sempre o banco (get_my_community_creation_eligibility / create_community): "eligible"
// verdadeiro nesta tela nunca autoriza nada, e nenhum valor calculado aqui é enviado como
// verdade -- só o tier escolhido, a forma de pagamento e a chave de idempotência.

export const WIZARD_STEPS = ['eligibility', 'info', 'retention', 'payment', 'review']

export const TIER_LABELS = {
  essential: 'Essencial',
  plus: 'Plus',
  archive: 'Arquivo',
}

export const RETENTION_COPY = {
  '24h': { title: '24 horas', description: 'Uma comunidade mais dinâmica.' },
  '30d': { title: '30 dias', description: 'Conteúdo disponível por mais tempo.' },
  no_auto_expiration: {
    title: 'Sem expiração automática',
    description: 'Para conteúdo que deve continuar disponível.',
  },
}

export const PAYMENT_LABELS = { evocoins: 'EvoCoins', evocash: 'EvoCash' }

const plural = (count, singular, pluralForm) => `${count} ${count === 1 ? singular : pluralForm}`

function progressOf(done, required) {
  if (!(required > 0)) return 1
  return Math.min(Math.max(done / required, 0), 1)
}

// Itens da seção "Sua elegibilidade". Os rótulos mostram só requisitos públicos (dias de
// conta, dias ativos, situação, limite, custo) -- nada de regra interna de segurança.
export function buildEligibilityChecklist(eligibility) {
  if (!eligibility) return []
  const accountDone = eligibility.accountDays >= eligibility.requiredAccountDays
  const activeDone = eligibility.qualifiedDays >= eligibility.requiredQualifiedDays
  const regular = eligibility.accountStanding === 'regular'
  const underLimit = eligibility.activeOwnedCommunities < eligibility.communityLimit
  return [
    {
      key: 'email',
      label: 'E-mail confirmado',
      done: eligibility.emailVerified === true,
      detail: eligibility.emailVerified ? 'Tudo certo' : 'Confirme seu e-mail',
    },
    {
      key: 'standing',
      label: 'Situação da conta',
      done: regular,
      detail: regular ? 'Tudo certo' : 'Indisponível no momento',
    },
    {
      key: 'accountAge',
      label: 'Conta no Evolutus',
      done: accountDone,
      detail: `${Math.min(eligibility.accountDays, eligibility.requiredAccountDays)} / ${eligibility.requiredAccountDays} dias`,
      progress: progressOf(eligibility.accountDays, eligibility.requiredAccountDays),
    },
    {
      key: 'activeDays',
      label: 'Atividade',
      done: activeDone,
      detail: `${Math.min(eligibility.qualifiedDays, eligibility.requiredQualifiedDays)} / ${eligibility.requiredQualifiedDays} dias ativos`,
      progress: progressOf(eligibility.qualifiedDays, eligibility.requiredQualifiedDays),
    },
    {
      key: 'limit',
      label: 'Comunidades próprias',
      done: underLimit,
      detail: `${eligibility.activeOwnedCommunities} / ${eligibility.communityLimit}`,
    },
  ]
}

// O que ainda falta, só com requisitos públicos. Restrição/moderação NUNCA detalha o motivo:
// `restricted` vira uma mensagem genérica (com acesso ao atendimento na tela).
export function describeEligibilityGap(eligibility) {
  if (!eligibility) return { eligible: false, restricted: false, missing: [], message: '' }
  if (eligibility.eligible) return { eligible: true, restricted: false, missing: [], message: '' }

  if (eligibility.accountStanding !== 'regular') {
    return {
      eligible: false,
      restricted: true,
      missing: [],
      message: 'Sua conta não está elegível para criar comunidades neste momento.',
    }
  }

  const missing = []
  const accountGap = Math.max(eligibility.requiredAccountDays - eligibility.accountDays, 0)
  const activeGap = Math.max(eligibility.requiredQualifiedDays - eligibility.qualifiedDays, 0)
  if (eligibility.emailVerified !== true) missing.push('confirmar seu e-mail')
  if (accountGap > 0) missing.push(plural(accountGap, 'dia de conta', 'dias de conta'))
  if (activeGap > 0) missing.push(plural(activeGap, 'dia ativo', 'dias ativos'))
  const limitReached = eligibility.activeOwnedCommunities >= eligibility.communityLimit

  let message = 'Você ainda não pode criar uma comunidade.'
  if (missing.length > 0) {
    const joined =
      missing.length === 1
        ? missing[0]
        : `${missing.slice(0, -1).join(', ')} e ${missing[missing.length - 1]}`
    message = `Faltam ${joined} para liberar a criação.`
    if (missing[0] === 'confirmar seu e-mail' && missing.length === 1) {
      message = 'Falta confirmar seu e-mail para liberar a criação.'
    }
  } else if (limitReached) {
    message = `Você já tem ${eligibility.communityLimit} comunidades ativas. Encerre uma para criar outra.`
  }
  return { eligible: false, restricted: false, missing, limitReached, message }
}

export function retentionCopy(mode) {
  return RETENTION_COPY[mode] || { title: mode, description: '' }
}

// Opções de pagamento VÁLIDAS para um produto: forma sem preço configurado não aparece
// (ex.: EvoCash enquanto o valor não foi definido; Arquivo nunca em EvoCoins).
export function paymentOptionsFor(product, eligibility) {
  if (!product) return []
  const options = []
  if (Number.isFinite(product.evoCoinsPrice) && product.evoCoinsPrice > 0) {
    const balance = eligibility?.evoCoinsBalance ?? 0
    options.push({
      method: 'evocoins',
      label: PAYMENT_LABELS.evocoins,
      price: product.evoCoinsPrice,
      balance,
      enough: balance >= product.evoCoinsPrice,
    })
  }
  if (Number.isFinite(product.evoCashPrice) && product.evoCashPrice > 0) {
    const balance = eligibility?.evoCashBalance ?? 0
    options.push({
      method: 'evocash',
      label: PAYMENT_LABELS.evocash,
      price: product.evoCashPrice,
      balance,
      enough: balance >= product.evoCashPrice,
    })
  }
  return options
}

export function productIsAvailable(product) {
  return paymentOptionsFor(product, null).length > 0
}

export function formatPrice(option) {
  return `${option.price} ${option.label}`
}

// Códigos levantados por create_community (ver 20261008000003_community_creation_rpcs.sql).
// Restrição/moderação (ACCOUNT_NOT_ELIGIBLE, ACCOUNT_DELETING) usa texto genérico de propósito.
const CREATE_ERRORS = {
  ACCOUNT_NOT_ELIGIBLE: 'Sua conta não está elegível para criar comunidades neste momento.',
  ACCOUNT_DELETING: 'Sua conta não está elegível para criar comunidades neste momento.',
  EMAIL_NOT_VERIFIED: 'Confirme seu e-mail para criar uma comunidade.',
  ACCOUNT_TOO_NEW: 'Sua conta ainda não atingiu o tempo mínimo para criar comunidades.',
  NOT_ACTIVE_ENOUGH: 'Você ainda não tem dias ativos suficientes para criar uma comunidade.',
  COMMUNITY_LIMIT_REACHED: 'Você já atingiu o limite de comunidades ativas.',
  INSUFFICIENT_COINS: 'Você não tem EvoCoins suficientes.',
  INSUFFICIENT_CASH: 'Você não tem EvoCash suficiente.',
  PAYMENT_METHOD_UNAVAILABLE:
    'Esta forma de pagamento não está disponível para este tipo de comunidade.',
  INVALID_TIER: 'Este tipo de comunidade não está disponível.',
  INVALID_PAYMENT_METHOD: 'Escolha uma forma de pagamento válida.',
  INVALID_NAME: 'Informe um nome de até 60 caracteres.',
  INVALID_DESCRIPTION: 'A descrição pode ter até 300 caracteres.',
  REQUEST_ID_CONFLICT:
    'Este pedido já foi usado para criar uma comunidade diferente. Revise e tente de novo.',
  CREATION_RULES_UNAVAILABLE: 'A criação de comunidades está indisponível no momento.',
}

export function creationErrorMessage(error) {
  const code = error?.message
  return CREATE_ERRORS[code] || 'Não foi possível criar a comunidade. Tente novamente.'
}

// Erros que NÃO se resolvem repetindo a mesma tentativa: a próxima precisa de chave nova.
// (Falha de rede/desconhecida mantém a chave -- o retry devolve o resultado original.)
export function shouldRenewRequestId(error) {
  return error?.message === 'REQUEST_ID_CONFLICT'
}

export function newIdempotencyKey() {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// Chave da "tentativa" para reaproveitar a chave de idempotência: mesma intenção = mesma
// chave, mesmo após duplo clique ou retry por conexão ruim.
export function attemptKeyOf({ name, description, iconName, tier, paymentMethod }) {
  return JSON.stringify([
    name?.trim() ?? '',
    description?.trim() ?? '',
    iconName ?? '',
    tier,
    paymentMethod,
  ])
}

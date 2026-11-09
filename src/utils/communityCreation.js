// Criação de comunidades -- lógica pura da UI (testável sem renderizar nada).
//
// Tudo aqui é APRESENTAÇÃO. Quem decide elegibilidade, preço, saldo, tier e retenção é
// sempre o banco (get_my_community_creation_eligibility / create_community): "eligible"
// verdadeiro nesta tela nunca autoriza nada, e nenhum valor calculado aqui é enviado como
// verdade -- só o tier escolhido, a forma de pagamento e a chave de idempotência.

export const WIZARD_STEPS = ['info', 'config', 'review']

export const TIER_LABELS = {
  starter: 'Grátis',
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

// Mesmo rank usado no servidor (upgrade_community_tier/community_tier_upgrade_quote): só para
// decidir, na UI, quais modalidades aparecem como "melhoria" possível -- o servidor recalcula
// e recusa (NOT_AN_UPGRADE) de qualquer forma, isto é só para não oferecer um botão inútil.
export const TIER_RANK = { legacy: 1, essential: 1, starter: 1, plus: 2, archive: 3 }

// Itens do aviso de elegibilidade (inline, sem etapa própria). Dias de conta/dias ativos NÃO
// são mais requisito -- deixaram de bloquear a criação (paga ou grátis), ver migration
// 20261214000003_community_creation_eligibility_simplify.sql. Mostrados aqui só como
// informação de progresso (ex.: "conta há X dias"), nunca como pendência que trava o botão.
export function buildEligibilityChecklist(eligibility) {
  if (!eligibility) return []
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
      key: 'limit',
      label: 'Comunidades próprias',
      done: underLimit,
      detail: `${eligibility.activeOwnedCommunities} / ${eligibility.communityLimit}`,
    },
  ]
}

// O que ainda falta, só com requisitos públicos (e-mail, situação da conta, limite).
// Restrição/moderação NUNCA detalha o motivo: `restricted` vira uma mensagem genérica (com
// acesso ao atendimento na tela).
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
  if (eligibility.emailVerified !== true) missing.push('confirmar seu e-mail')
  const limitReached = eligibility.activeOwnedCommunities >= eligibility.communityLimit

  let message = 'Você ainda não pode criar uma comunidade.'
  if (missing.length > 0) {
    message = 'Falta confirmar seu e-mail para liberar a criação.'
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

// Grátis é um sinal explícito do catálogo (product.free === true), nunca inferido por preço
// nulo/zero -- preço NULL em essential/plus/archive significa "forma de pagamento
// indisponível", não "grátis". Um produto pago sem nenhum preço configurado continua
// indisponível (ex.: archive hoje).
export function productIsAvailable(product) {
  if (!product) return false
  if (product.free === true) return true
  return paymentOptionsFor(product, null).length > 0
}

export function formatPrice(option) {
  return `${option.price} ${option.label}`
}

// Códigos levantados por create_community/create_free_community/upgrade_community_tier/
// quote_community_tier_upgrade/set_community_post_access (ver migrations 20261214000002 a
// 20261214000007). Restrição/moderação (ACCOUNT_NOT_ELIGIBLE, ACCOUNT_DELETING) usa texto
// genérico de propósito. ACCOUNT_TOO_NEW/NOT_ACTIVE_ENOUGH não existem mais em nenhum caminho
// (requisitos de dias removidos -- ver eligibility_simplify) e não aparecem aqui.
const CREATE_ERRORS = {
  ACCOUNT_NOT_ELIGIBLE: 'Sua conta não está elegível para criar comunidades neste momento.',
  ACCOUNT_DELETING: 'Sua conta não está elegível para criar comunidades neste momento.',
  SESSION_REVOKED: 'Sua sessão foi encerrada. Entre novamente.',
  EMAIL_NOT_VERIFIED: 'Confirme seu e-mail para criar uma comunidade.',
  COMMUNITY_LIMIT_REACHED: 'Você já atingiu o limite de comunidades ativas.',
  FREE_BENEFIT_ALREADY_USED: 'Você já usou sua comunidade gratuita.',
  INSUFFICIENT_COINS: 'Você não tem EvoCoins suficientes.',
  INSUFFICIENT_CASH: 'Você não tem EvoCash suficiente.',
  PAYMENT_METHOD_UNAVAILABLE:
    'Esta forma de pagamento não está disponível para este tipo de comunidade.',
  INVALID_TIER: 'Este tipo de comunidade não está disponível.',
  INVALID_PAYMENT_METHOD: 'Escolha uma forma de pagamento válida.',
  INVALID_POST_ACCESS: 'Escolha quem pode publicar antes de continuar.',
  INVALID_NAME: 'Informe um nome de até 60 caracteres.',
  INVALID_DESCRIPTION: 'A descrição pode ter até 300 caracteres.',
  REQUEST_ID_CONFLICT:
    'Este pedido já foi usado para criar uma comunidade diferente. Revise e tente de novo.',
  CREATION_RULES_UNAVAILABLE: 'A criação de comunidades está indisponível no momento.',
  // Upgrade de tier (quote_community_tier_upgrade/upgrade_community_tier).
  NOT_OWNER: 'Só o dono da comunidade pode fazer isso.',
  COMMUNITY_UNAVAILABLE: 'Esta comunidade não está disponível.',
  NOT_AN_UPGRADE: 'Essa modalidade não é uma melhoria em relação à atual.',
  PRICE_CHANGED: 'O preço mudou desde a última cotação. Confira o novo valor e confirme de novo.',
  INVALID_EXPECTED_AMOUNT: 'Cotação inválida. Peça uma nova cotação antes de confirmar.',
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

// Estes 3 códigos já aparecem com mensagem própria dentro de EligibilityPanel (etapa
// "info"), a partir do `eligibility` recarregado -- mostrar o Flash genérico de erro JUNTO
// duplicaria a mesma informação na tela (bug real: "ainda não pode criar uma comunidade"
// aparecendo duas vezes). FREE_BENEFIT_ALREADY_USED não tem equivalente ali (EligibilityPanel
// não sabe sobre o benefício gratuito), então esse continua no Flash genérico.
export function eligibilityPanelCoversError(code) {
  return code === 'ACCOUNT_NOT_ELIGIBLE' || code === 'EMAIL_NOT_VERIFIED' || code === 'COMMUNITY_LIMIT_REACHED'
}

export function newIdempotencyKey() {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// Chave da "tentativa" para reaproveitar a chave de idempotência: mesma intenção = mesma
// chave, mesmo após duplo clique ou retry por conexão ruim. postAccess entra aqui porque
// também faz parte do hash de idempotência no servidor (ver create_community/
// create_free_community) -- mudar só o post_access precisa contar como tentativa nova.
export function attemptKeyOf({ name, description, iconName, tier, paymentMethod, postAccess }) {
  return JSON.stringify([
    name?.trim() ?? '',
    description?.trim() ?? '',
    iconName ?? '',
    tier,
    paymentMethod ?? null,
    postAccess ?? 'everyone',
  ])
}

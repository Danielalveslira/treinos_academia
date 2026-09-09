import { validId } from './legal-core.js'

const DAY_MS = 86400000

// Se o dia de vencimento (ex: 31) não existir no mês seguinte, usa o último dia válido.
function clampDay(year, monthIndex, day) {
  const lastDayOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return Math.min(day, lastDayOfMonth)
}

// Preserva o dia-âncora da cobrança (billingAnchorDay) em vez de somar 30 dias corridos,
// para que o vencimento não "derive" mês a mês (ex: sempre dia 10, nunca dia 8 ou 12).
export function computeNextPaymentDate(fromMillis, anchorDay) {
  const from = new Date(fromMillis)
  const year = from.getUTCFullYear()
  const monthIndex = from.getUTCMonth() + 1
  const day = clampDay(year, monthIndex, anchorDay)
  return Date.UTC(
    year + Math.floor(monthIndex / 12),
    monthIndex % 12,
    day,
    from.getUTCHours(),
    from.getUTCMinutes(),
    from.getUTCSeconds()
  )
}

// MVP: considera apenas segunda a sexta, sem calendário de feriados (ver arquitetura §20).
export function addBusinessDays(fromMillis, businessDays) {
  let result = fromMillis
  let remaining = businessDays
  while (remaining > 0) {
    result += DAY_MS
    const weekday = new Date(result).getUTCDay()
    if (weekday !== 0 && weekday !== 6) remaining -= 1
  }
  return result
}

// Espelha exatamente a lógica usada em firestore.rules (subscriptionAllowsAccess) para que
// o frontend mostre o mesmo estado que a regra de segurança realmente aplica.
export function getSubscriptionState(subscription, nowMillis = Date.now()) {
  if (!subscription || !subscription.trialEndsAt) return 'NONE'
  const toMillis = (value) => value?.toMillis?.() ?? new Date(value).getTime()
  if (subscription.paidAt == null) {
    return nowMillis < toMillis(subscription.trialEndsAt) ? 'TRIAL_ACTIVE' : 'BLOCKED'
  }
  const nextPaymentAt = toMillis(subscription.nextPaymentAt)
  const graceEndsAt = toMillis(subscription.graceEndsAt)
  if (nowMillis < nextPaymentAt) return 'ACTIVE'
  if (nowMillis < nextPaymentAt + DAY_MS) return 'PAYMENT_DUE'
  if (nowMillis < graceEndsAt) return 'GRACE_PERIOD'
  return 'BLOCKED'
}

export function validateConfirmPayment(data) {
  if (!validId(data?.userId)) return 'Usuário inválido.'
  if (!validId(data?.planId)) return 'Selecione um plano válido.'
  return null
}

export function validateSetAccountStatus(data) {
  if (!validId(data?.userId)) return 'Usuário inválido.'
  if (typeof data?.disabled !== 'boolean') return 'Informe o novo estado da conta.'
  if (data.disabled) {
    if (
      typeof data.reason !== 'string' ||
      data.reason.trim().length < 5 ||
      data.reason.length > 500
    ) {
      return 'Informe o motivo da desativação (5 a 500 caracteres).'
    }
  }
  return null
}

export function validateDeleteAccount(data) {
  if (!validId(data?.userId)) return 'Usuário inválido.'
  if (data?.confirmation !== 'EXCLUIR') return 'Digite EXCLUIR para confirmar.'
  return null
}

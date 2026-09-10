// Espelha exatamente firestore.rules (subscriptionAllowsAccess) e functions/billing-core.js
// (getSubscriptionState) — três lugares, uma única regra de negócio. Isto aqui só decide o
// que mostrar na tela; a regra de segurança real vive em firestore.rules.
const DAY_MS = 86400000

export const DEFAULT_BILLING_CONFIG = {
  trialDays: 3,
  warningDaysBeforeDue: 2,
  graceBusinessDays: 1,
  pixKey: '',
  pixKeyType: 'email',
  receiverName: '',
  whatsapp: '',
  plans: [
    { id: 'basico', name: 'Básico', price: 25.9, billingCycle: 'monthly', highlight: false },
    { id: 'plus', name: 'Plus', price: 39.9, billingCycle: 'monthly', highlight: true },
  ],
}

function toMillis(value) {
  if (value == null) return null
  return value?.toMillis?.() ?? new Date(value).getTime()
}

export function getSubscriptionState(subscription, nowMillis = Date.now()) {
  if (!subscription || !subscription.trialEndsAt) return 'NONE'
  if (subscription.paidAt == null) {
    return nowMillis < toMillis(subscription.trialEndsAt) ? 'TRIAL_ACTIVE' : 'BLOCKED'
  }
  const nextPaymentAt = toMillis(subscription.nextPaymentAt)
  const graceEndsAt = toMillis(subscription.graceEndsAt)
  if (nowMillis < nextPaymentAt) return 'ACTIVE'
  if (nowMillis < nextPaymentAt + DAY_MS) return 'PAYMENT_DUE'
  if (graceEndsAt != null && nowMillis < graceEndsAt) return 'GRACE_PERIOD'
  return 'BLOCKED'
}

// Ordem de prioridade do controle de acesso: autenticação (já garantida por quem chama) →
// conta desativada → estado da assinatura. Superadmin nunca é bloqueado pela própria
// assinatura, para poder sempre gerenciar o sistema.
export function getUserAccessState(profile, nowMillis = Date.now()) {
  if (!profile) return { canAccess: false, reason: 'loading' }
  if (profile.role === 'superadmin') return { canAccess: true, reason: 'superadmin' }
  if (profile.accountStatus === 'disabled') {
    return { canAccess: false, reason: 'disabled', disabledReason: profile.disabledReason }
  }
  const status = getSubscriptionState(profile.subscription, nowMillis)
  const canAccess = ['TRIAL_ACTIVE', 'ACTIVE', 'PAYMENT_DUE', 'GRACE_PERIOD'].includes(status)
  return { canAccess, reason: 'subscription', status }
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export function formatDate(value) {
  const millis = toMillis(value)
  if (millis == null) return ''
  return new Intl.DateTimeFormat('pt-BR').format(new Date(millis))
}

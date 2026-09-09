import { Link } from 'react-router-dom'
import { Button, Flash } from '@primer/react'
import { getSubscriptionState, formatDate } from '../utils/billing'
import { useBillingConfig } from '../hooks/useBillingConfig'

const DAY_MS = 86400000
const flexSx = { display: 'flex', alignItems: 'center', gap: 3, mb: 3, flexWrap: 'wrap' }

// Reaproveita o mesmo componente (Flash do Primer) para trial, vencimento e tolerância —
// só a mensagem, o variant e o destino do CTA mudam entre os estados.
export function SubscriptionBanner({ profile }) {
  const { config } = useBillingConfig()
  if (!profile || profile.role === 'superadmin' || !profile.subscription) return null

  const status = getSubscriptionState(profile.subscription)
  const cta = (
    <Button as={Link} to="/pagamento" size="small" sx={{ ml: 'auto', flexShrink: 0 }}>
      {status === 'TRIAL_ACTIVE'
        ? 'Assinar agora'
        : status === 'PAYMENT_DUE'
          ? 'Renovar'
          : 'Regularizar pagamento'}
    </Button>
  )

  if (status === 'TRIAL_ACTIVE') {
    return (
      <Flash sx={flexSx}>
        Período gratuito ativo. Seu acesso gratuito termina em{' '}
        {formatDate(profile.subscription.trialEndsAt)}.{cta}
      </Flash>
    )
  }
  if (status === 'ACTIVE') {
    const daysUntilDue = Math.ceil(
      (profile.subscription.nextPaymentAt.toMillis() - Date.now()) / DAY_MS
    )
    if (daysUntilDue > (config.warningDaysBeforeDue ?? 2)) return null
    return (
      <Flash variant="attention" sx={flexSx}>
        {daysUntilDue <= 0
          ? 'Sua assinatura vence hoje.'
          : daysUntilDue === 1
            ? 'Sua assinatura vence amanhã.'
            : `Sua assinatura vence em ${daysUntilDue} dias, em ${formatDate(profile.subscription.nextPaymentAt)}.`}
        {cta}
      </Flash>
    )
  }
  if (status === 'PAYMENT_DUE') {
    return (
      <Flash variant="attention" sx={flexSx}>
        Sua assinatura vence hoje.{cta}
      </Flash>
    )
  }
  if (status === 'GRACE_PERIOD') {
    return (
      <Flash variant="danger" sx={flexSx}>
        Seu pagamento está pendente. Regularize até {formatDate(profile.subscription.graceEndsAt)}{' '}
        para evitar o bloqueio.{cta}
      </Flash>
    )
  }
  return null
}

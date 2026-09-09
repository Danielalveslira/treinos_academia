import { Button, Spinner } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { SubscriptionPanel } from './SubscriptionPanel'
import { useAuth } from '../hooks/useAuth'
import { useBillingConfig } from '../hooks/useBillingConfig'
import { getUserAccessState } from '../utils/billing'
import { logoutUser } from '../services/authService'

// Prioridade de acesso (ver arquitetura de assinatura): conta desativada bloqueia
// independentemente da assinatura; só depois disso avalia trial/vencimento/tolerância.
export function SubscriptionGate({ children }) {
  const { user, profile } = useAuth()
  const { config, loading } = useBillingConfig()
  const accessState = getUserAccessState(profile)

  if (accessState.canAccess) return children

  if (accessState.reason === 'disabled') {
    return (
      <PublicLayout>
        <section className="support-page" aria-labelledby="account-disabled-title">
          <h1 id="account-disabled-title">Conta desativada</h1>
          <p>Sua conta foi desativada pelo administrador.</p>
          {accessState.disabledReason && (
            <p>
              <strong>Motivo:</strong> {accessState.disabledReason}
            </p>
          )}
          <Button onClick={logoutUser}>Sair da conta</Button>
        </section>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout>
      <section className="support-page" aria-labelledby="subscription-gate-title">
        <h1 id="subscription-gate-title">Assinatura pendente</h1>
        {loading ? (
          <Spinner aria-label="Carregando informações de pagamento" />
        ) : (
          <SubscriptionPanel
            profile={profile}
            email={user?.email}
            accessState={accessState}
            billingConfig={config}
          />
        )}
        <Button onClick={logoutUser} sx={{ mt: 3 }}>
          Sair da conta
        </Button>
      </section>
    </PublicLayout>
  )
}

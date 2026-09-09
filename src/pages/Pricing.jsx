import { Link as RouterLink } from 'react-router-dom'
import { Button, Label, Spinner } from '@primer/react'
import { PublicLayout } from '../components/PublicLayout'
import { CheckCircleFillIcon, ZapIcon, RocketIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useBillingConfig } from '../hooks/useBillingConfig'
import { formatCurrency } from '../utils/billing'

const PLAN_ICONS = { basico: ZapIcon, plus: RocketIcon }
const PLAN_FEATURES = {
  basico: [
    'Exercícios e treinos ilimitados',
    'Histórico completo e dashboard',
    'Cancele quando quiser',
  ],
  plus: ['Tudo do plano Básico', 'Prioridade no atendimento', 'Acesso antecipado a novidades'],
}

export default function Pricing() {
  const { user } = useAuth()
  const { config, loading } = useBillingConfig()

  return (
    <PublicLayout>
      <section className="pricing-layout" aria-labelledby="pricing-title">
        <div className="pricing-heading">
          <span className="public-eyebrow">PLANOS TREINOS</span>
          <h1 id="pricing-title">Invista na sua constância.</h1>
          <p>
            Escolha como acompanhar sua evolução.
            <br />
            Seus exercícios, registros e progresso em um só lugar.
          </p>
          <Label>3 dias grátis para testar</Label>
        </div>
        {loading ? (
          <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />
        ) : (
          <div className="pricing-grid">
            {config.plans.map((plan) => {
              const Icon = PLAN_ICONS[plan.id] || ZapIcon
              const features = PLAN_FEATURES[plan.id] || []
              return (
                <article
                  key={plan.id}
                  className={`plan-card${plan.highlight ? ' plan-highlight' : ''}`}
                >
                  <div className="plan-topline">
                    <span className="benefit-icon">
                      <Icon size={22} />
                    </span>
                    {plan.highlight && <Label variant="accent">Melhor custo-benefício</Label>}
                  </div>
                  <h2>{plan.name}</h2>
                  <p className="plan-description">
                    Acesso ilimitado enquanto sua assinatura estiver ativa.
                  </p>
                  <div className="plan-price">
                    {formatCurrency(plan.price)}
                    <span>/mês</span>
                  </div>
                  <div className="plan-features">
                    <span>O QUE ESTÁ INCLUÍDO</span>
                    <ul>
                      {features.map((feature) => (
                        <li key={feature}>
                          <CheckCircleFillIcon size={16} />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Button
                    as={RouterLink}
                    to={user ? '/pagamento' : '/cadastro'}
                    variant={plan.highlight ? 'primary' : 'default'}
                    size="large"
                    block
                  >
                    Começar agora
                  </Button>
                </article>
              )
            })}
          </div>
        )}
        <div className="pricing-note">
          <h2>Seu próximo treino começa aqui.</h2>
          <p>Já tem uma conta? Acesse seu diário de treinos.</p>
          <Button as={RouterLink} to="/login">
            Entrar na minha conta
          </Button>
        </div>
      </section>
    </PublicLayout>
  )
}

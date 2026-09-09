import { Link as RouterLink } from 'react-router-dom'
import { Button, Label } from '@primer/react'
import { PublicLayout } from '../components/PublicLayout'
import { CheckCircleFillIcon, ZapIcon, RocketIcon } from '@primer/octicons-react'

const PLANS = [
  {
    id: 'mensal',
    name: 'Mensal',
    icon: ZapIcon,
    price: 'R$ 9,90',
    period: '/mês',
    description: 'Acesso ilimitado enquanto sua assinatura estiver ativa.',
    features: [
      'Exercícios e treinos ilimitados',
      'Histórico completo e dashboard',
      'Cancele quando quiser',
    ],
    highlight: false,
  },
  {
    id: 'vitalicio',
    name: 'Vitalício',
    icon: RocketIcon,
    price: 'R$ 149,90',
    period: 'pagamento único',
    description: 'Pague uma vez, use para sempre.',
    features: ['Tudo do plano mensal', 'Acesso ilimitado para sempre', 'Sem cobranças recorrentes'],
    highlight: true,
  },
]

export default function Pricing() {
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
          <Label>Assinaturas em breve</Label>
        </div>
        <div className="pricing-grid">
          {PLANS.map((plan) => (
            <article
              key={plan.id}
              className={`plan-card${plan.highlight ? ' plan-highlight' : ''}`}
            >
              <div className="plan-topline">
                <span className="benefit-icon">
                  <plan.icon size={22} />
                </span>
                {plan.highlight && <Label variant="accent">Melhor custo-benefício</Label>}
              </div>
              <h2>{plan.name}</h2>
              <p className="plan-description">{plan.description}</p>
              <div className="plan-price">
                {plan.price}
                <span>{plan.period}</span>
              </div>
              <div className="plan-features">
                <span>O QUE ESTÁ INCLUÍDO</span>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <CheckCircleFillIcon size={16} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Button variant={plan.highlight ? 'primary' : 'default'} size="large" block disabled>
                Disponível em breve
              </Button>
            </article>
          ))}
        </div>
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

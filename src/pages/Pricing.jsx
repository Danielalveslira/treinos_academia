import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Heading, Text, Label, Link } from '@primer/react'
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
    price: 'R$ 49,90',
    period: 'pagamento único',
    description: 'Pague uma vez, use para sempre.',
    features: ['Tudo do plano mensal', 'Acesso ilimitado para sempre', 'Sem cobranças recorrentes'],
    highlight: true,
  },
]

export default function Pricing() {
  return (
    <Box sx={{ minHeight: '100vh', px: 3, py: 5 }}>
      <Box sx={{ maxWidth: '720px', mx: 'auto' }}>
        <Box sx={{ textAlign: 'center', mb: 5 }}>
          <Heading as="h1" sx={{ fontSize: 5, mb: 2 }}>
            Planos Treinos
          </Heading>
          <Text sx={{ color: 'fg.muted', fontSize: 2, display: 'block' }}>
            Escolha como quer acompanhar sua evolução na academia.
          </Text>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: ['1fr', '1fr', '1fr 1fr'],
            gap: 3,
          }}
        >
          {PLANS.map((plan) => (
            <Box
              key={plan.id}
              sx={{
                border: '1px solid',
                borderColor: plan.highlight ? 'accent.emphasis' : 'border.default',
                borderRadius: 3,
                p: 4,
                position: 'relative',
                bg: 'canvas.default',
              }}
            >
              {plan.highlight && (
                <Label variant="accent" sx={{ position: 'absolute', top: 3, right: 3 }}>
                  Melhor custo-benefício
                </Label>
              )}

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <plan.icon size={20} fill="var(--fgColor-accent)" />
                <Heading as="h2" sx={{ fontSize: 3 }}>
                  {plan.name}
                </Heading>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Text sx={{ fontSize: 6, fontWeight: 'bold' }}>{plan.price}</Text>
                <Text sx={{ color: 'fg.muted', fontSize: 1, ml: 1 }}>{plan.period}</Text>
              </Box>

              <Text sx={{ color: 'fg.muted', fontSize: 1, display: 'block', mb: 3 }}>
                {plan.description}
              </Text>

              <Box as="ul" sx={{ listStyle: 'none', p: 0, m: 0, mb: 4 }}>
                {plan.features.map((feature) => (
                  <Box
                    key={feature}
                    as="li"
                    sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}
                  >
                    <CheckCircleFillIcon size={16} fill="var(--fgColor-success)" />
                    <Text sx={{ fontSize: 1 }}>{feature}</Text>
                  </Box>
                ))}
              </Box>

              <Button variant={plan.highlight ? 'primary' : 'default'} block disabled>
                Em breve
              </Button>
            </Box>
          ))}
        </Box>

        <Box sx={{ textAlign: 'center', mt: 5 }}>
          <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
            Já tem uma conta?{' '}
            <Link as={RouterLink} to="/login">
              Entrar
            </Link>
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

import { useState } from 'react'
import { Box, Button, Heading, Text, Label, Flash } from '@primer/react'
import { CopyIcon, CheckIcon, DeviceMobileIcon } from '@primer/octicons-react'
import { formatCurrency, formatDate } from '../utils/billing'

const PIX_KEY_TYPE_LABELS = {
  email: 'E-mail',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  phone: 'Telefone',
  random: 'Chave aleatória',
}

function whatsappLink(whatsapp, plan, profile, email) {
  const digits = (whatsapp || '').replace(/\D/g, '')
  const message = `Olá! Realizei o pagamento da assinatura.\nPlano: ${plan?.name || ''}\nUsuário: ${
    profile?.username || ''
  }\nE-mail: ${email || ''}`
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

export function SubscriptionPanel({ profile, email, accessState, billingConfig }) {
  const plans = billingConfig.plans || []
  const [planId, setPlanId] = useState(profile?.subscription?.planId || plans[0]?.id)
  const [copied, setCopied] = useState(false)
  const plan = plans.find((p) => p.id === planId) || plans[0]
  const status = accessState.status

  async function copyPixKey() {
    try {
      await navigator.clipboard.writeText(billingConfig.pixKey || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard indisponível (ex: contexto não seguro) — a chave já está visível na tela.
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 480, mx: 'auto' }}>
      {status === 'TRIAL_ACTIVE' && (
        <Flash variant="default">
          Período gratuito ativo. Termina em {formatDate(profile.subscription.trialEndsAt)}.
        </Flash>
      )}
      {status === 'PAYMENT_DUE' && (
        <Flash variant="attention">
          Sua assinatura vence hoje, {formatDate(profile.subscription.nextPaymentAt)}.
        </Flash>
      )}
      {status === 'GRACE_PERIOD' && (
        <Flash variant="attention">
          Seu pagamento está pendente. Regularize até {formatDate(profile.subscription.graceEndsAt)}{' '}
          para evitar o bloqueio.
        </Flash>
      )}
      {status === 'BLOCKED' && (
        <Flash variant="danger">
          Seu acesso está temporariamente suspenso. Realize o pagamento para reativar sua conta.
        </Flash>
      )}

      <Box sx={{ display: 'flex', gap: 2 }}>
        {plans.map((p) => (
          <Box
            key={p.id}
            as="button"
            type="button"
            onClick={() => setPlanId(p.id)}
            sx={{
              flex: 1,
              textAlign: 'left',
              cursor: 'pointer',
              appearance: 'none',
              font: 'inherit',
              color: 'fg.default',
              border: '1px solid',
              borderColor: p.id === planId ? 'accent.emphasis' : 'border.default',
              borderRadius: 2,
              p: 3,
              bg: p.id === planId ? 'accent.subtle' : 'canvas.default',
            }}
          >
            <Text sx={{ display: 'block', fontWeight: 'bold' }}>{p.name}</Text>
            <Text sx={{ display: 'block', fontSize: 3, fontWeight: 'bold' }}>
              {formatCurrency(p.price)}
              <Text sx={{ fontSize: 0, fontWeight: 'normal', color: 'fg.muted' }}>/mês</Text>
            </Text>
            {p.highlight && <Label variant="accent">Melhor custo-benefício</Label>}
          </Box>
        ))}
      </Box>

      <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3 }}>
        <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
          Assinatura {plan?.name}
        </Heading>
        <Text sx={{ display: 'block', fontSize: 4, fontWeight: 'bold', mb: 3 }}>
          {formatCurrency(plan?.price || 0)}
          <Text sx={{ fontSize: 1, fontWeight: 'normal', color: 'fg.muted' }}>/mês</Text>
        </Text>
        <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', mb: 1 }}>
          PIX ({PIX_KEY_TYPE_LABELS[billingConfig.pixKeyType] || billingConfig.pixKeyType})
        </Text>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            p: 2,
            bg: 'canvas.subtle',
            borderRadius: 2,
            mb: 3,
          }}
        >
          <Text sx={{ flex: 1, fontFamily: 'mono', wordBreak: 'break-all' }}>
            {billingConfig.pixKey || 'Chave PIX não configurada'}
          </Text>
          <Button
            size="small"
            leadingVisual={copied ? CheckIcon : CopyIcon}
            onClick={copyPixKey}
            disabled={!billingConfig.pixKey}
          >
            {copied ? 'Copiado' : 'Copiar PIX'}
          </Button>
        </Box>
        {billingConfig.receiverName && (
          <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', mb: 3 }}>
            Recebedor: {billingConfig.receiverName}
          </Text>
        )}
        <Text sx={{ display: 'block', mb: 2 }}>
          Após realizar o pagamento, envie o comprovante pelo WhatsApp.
        </Text>
        <Button
          as="a"
          href={whatsappLink(billingConfig.whatsapp, plan, profile, email)}
          target="_blank"
          rel="noreferrer"
          variant="primary"
          block
          leadingVisual={DeviceMobileIcon}
          disabled={!billingConfig.whatsapp}
        >
          Enviar comprovante pelo WhatsApp
        </Button>
      </Box>
    </Box>
  )
}

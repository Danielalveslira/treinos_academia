import { BellIcon } from '@primer/octicons-react'
import { Box, Button, Flash, Label, Text } from '@primer/react'
import { useDevicePush } from '../hooks/useDevicePush'

// Um único controle para TODAS as categorias de Push da conta. Não há switches por
// categoria nem botão de teste: a confirmação é a mensagem de boas-vindas enviada pelo servidor.
// A Central de Notificações funciona independentemente deste controle.
const STATES = {
  active: { label: 'Ativo neste dispositivo', variant: 'success' },
  inactive: { label: 'Desativado', variant: 'secondary' },
  checking: { label: 'Verificando…', variant: 'secondary' },
  blocked: { label: 'Bloqueado no navegador', variant: 'danger' },
  unavailable: { label: 'Indisponível', variant: 'secondary' },
  install: { label: 'Instalação necessária', variant: 'attention' },
  error: { label: 'Não verificado', variant: 'attention' },
}

const HELP = {
  blocked:
    'As notificações estão bloqueadas para este site. Libere nas configurações do navegador e volte ao app.',
  unavailable: 'Este navegador não oferece notificações Push.',
  install:
    'No iPhone e no iPad, adicione o Evolutus à Tela de Início (Compartilhar → Adicionar à Tela de Início) e ative pelo app instalado.',
  error: 'Não foi possível verificar este dispositivo. Verifique sua conexão.',
}

export function PushNotificationSettings({ userId = null, compact = false } = {}) {
  const push = useDevicePush(userId)
  const accountEnabled = push.device?.status?.enabled === true
  const status =
    accountEnabled && !push.active
      ? { label: 'Ativo na conta; este dispositivo não está inscrito', variant: 'attention' }
      : STATES[push.state] || STATES.inactive
  const canAct = push.allowed && !push.busy && ['active', 'inactive', 'error'].includes(push.state)
  // Mensagem do último clique substitui a ajuda genérica do estado (nunca duas explicações juntas).
  const help = push.message ? null : HELP[push.state]
  return (
    <section
      className="profile-card"
      aria-label={compact ? 'Configurações de notificações' : undefined}
      aria-labelledby={compact ? undefined : 'push-heading'}
      aria-busy={push.busy || push.state === 'checking'}
    >
      {!compact && (
        <header className="profile-card-heading">
          <span className="profile-section-icon">
            <BellIcon size={20} />
          </span>
          <div>
            <h2 id="push-heading">Notificações</h2>
          </div>
        </header>
      )}
      <Box sx={{ display: 'grid', gap: 3 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
          <Text as="p" sx={{ m: 0, flex: '1 1 220px', color: 'fg.muted', fontSize: 1 }}>
            Receba lembretes de treino, interações e atualizações importantes.
          </Text>
          <Label variant={status.variant} role="status">
            {status.label}
          </Label>
        </Box>
        {push.message && (
          <Flash variant={push.success ? 'success' : 'default'} role="status">
            {push.message}
          </Flash>
        )}
        {help && (
          <Text as="p" sx={{ m: 0, color: 'fg.muted', fontSize: 1 }}>
            {help}
          </Text>
        )}
        <Box>
          <Button
            type="button"
            variant={accountEnabled ? 'default' : 'primary'}
            onClick={accountEnabled ? push.disable : push.enable}
            loading={push.busy}
            disabled={!canAct}
            block
          >
            {accountEnabled ? 'Desativar notificações Push' : 'Ativar notificações Push'}
          </Button>
        </Box>
      </Box>
    </section>
  )
}

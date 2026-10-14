import { BellIcon } from '@primer/octicons-react'
import { Button, Flash } from '@primer/react'
import { useDevicePush } from '../hooks/useDevicePush'

export function PushNotificationSettings({ userId = null } = {}) {
  const push = useDevicePush(userId)
  const installation = push.support.reason === 'ios-install-required'
  const preferenceOff = push.device?.status?.enabled === false
  const registered =
    push.permission === 'granted' &&
    Boolean(push.device?.endpoint && push.device?.status?.thisDevice) &&
    !push.optedOut
  const title = installation
    ? 'Instalação necessária'
    : !push.support.supported
      ? 'Indisponível'
      : push.permission === 'denied'
        ? 'Permissão bloqueada'
        : push.failed
          ? 'Erro de verificação'
          : push.active
            ? 'Ativo neste dispositivo'
            : push.permission === 'granted' && !push.device && !push.optedOut
              ? 'Verificando…'
              : 'Desativado'
  return (
    <section className="profile-card" aria-labelledby="push-heading">
      <header className="profile-card-heading">
        <span className="profile-section-icon">
          <BellIcon size={20} />
        </span>
        <div>
          <h2 id="push-heading">Notificações no dispositivo</h2>
          <p>{title}</p>
        </div>
      </header>
      <div className="profile-form">
        {push.message && <Flash role="status">{push.message}</Flash>}
        {installation && (
          <p>
            Adicione o Evolutus à Tela de Início pelo menu Compartilhar do Safari e abra o app
            instalado.
          </p>
        )}
        {!push.support.supported && !installation && <p>Este navegador não oferece Web Push.</p>}
        {push.permission === 'denied' && (
          <p>
            A permissão está bloqueada. Libere notificações nas configurações do navegador e volte
            ao app.
          </p>
        )}
        {push.failed && (
          <p>
            Não foi possível verificar este dispositivo. Verifique sua conexão e tente novamente.
          </p>
        )}
        {preferenceOff && (
          <p>
            Ao ativar, as notificações serão habilitadas neste dispositivo. Outros dispositivos da
            conta que estavam desligados continuarão dependendo de ativação própria.
          </p>
        )}
        {!push.active && push.device?.status?.activeSubscriptions > 0 && (
          <p className="pwa-muted">
            Há notificações ativas em outro dispositivo da conta; este ainda não está confirmado.
          </p>
        )}
        <Button
          type="button"
          variant={push.active ? 'danger' : 'primary'}
          onClick={push.active ? push.disable : push.enable}
          loading={push.busy}
          disabled={
            push.busy || !push.allowed || !push.support.supported || push.permission === 'denied'
          }
        >
          {push.active ? 'Desativar neste dispositivo' : 'Ativar notificações'}
        </Button>
        {registered && !push.active && (
          <Button type="button" onClick={push.disable} disabled={push.busy || !push.allowed}>
            Desativar neste dispositivo
          </Button>
        )}
        <p className="pwa-muted">
          Os avisos dependem da compatibilidade do dispositivo, permissão do navegador,
          configurações do sistema, conexão e entrega do provedor.
        </p>
      </div>
    </section>
  )
}

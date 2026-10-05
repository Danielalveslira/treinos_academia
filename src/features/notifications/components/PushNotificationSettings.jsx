import { useEffect, useState } from 'react'
import { BellIcon, CheckIcon } from '@primer/octicons-react'
import { Button, Flash } from '@primer/react'
import {
  describePushError,
  disablePushNotifications,
  enablePushNotifications,
  getLocalPushEndpoint,
  getPushStatus,
  pushSupport,
} from '../services/pushService'

const ENABLE_ERRORS = {
  'vapid-not-configured': 'Push ainda não foi configurado pelo Evolutus.',
  'service-worker-unavailable': 'O app ainda não está pronto para notificações. Recarregue a página e tente de novo.',
}

export function PushNotificationSettings() {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [support] = useState(pushSupport)
  const permission = typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'

  // O estado é deste dispositivo (endpoint local), não a contagem de dispositivos da conta.
  // Sem suporte a Push não há consulta nenhuma.
  useEffect(() => {
    if (!support.supported) return undefined
    let active = true
    getLocalPushEndpoint()
      .catch(() => null)
      .then((endpoint) => getPushStatus(endpoint))
      .then((value) => active && setStatus(value))
      .catch((error) => {
        console.error('[Push] status failed', describePushError(error))
        if (active) setStatus({ enabled: false, thisDevice: false, error: describePushError(error) })
      })
    return () => { active = false }
  }, [support.supported])

  async function enable() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await enablePushNotifications()
      if (result.permission === 'granted') {
        setStatus(result.status)
        setMessage({ variant: 'success', text: 'Notificações ativadas neste dispositivo.' })
      } else if (result.permission === 'denied') {
        setMessage({ variant: 'warning', text: 'Permissão bloqueada. Libere notificações nas configurações do navegador.' })
      } else {
        setMessage({ variant: 'warning', text: 'A permissão não foi concedida. Toque em ativar para tentar de novo.' })
      }
    } catch (error) {
      const detail = describePushError(error)
      console.error('[Push] enable failed', detail)
      setMessage({
        variant: 'danger',
        text: ENABLE_ERRORS[error?.code] || 'Não foi possível ativar notificações.',
        detail,
      })
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setMessage(null)
    try {
      await disablePushNotifications()
      setStatus((current) => ({ ...current, thisDevice: false }))
      setMessage({ variant: 'success', text: 'Notificações desativadas neste dispositivo.' })
    } catch (error) {
      const detail = describePushError(error)
      console.error('[Push] disable failed', detail)
      setMessage({ variant: 'danger', text: 'Não foi possível desativar notificações.', detail })
    } finally {
      setBusy(false)
    }
  }

  const active = permission === 'granted' && Boolean(status?.thisDevice)
  return (
    <section className="profile-card" aria-labelledby="push-heading">
      <header className="profile-card-heading">
        <span className="profile-section-icon"><BellIcon size={20} /></span>
        <div>
          <h2 id="push-heading">Notificações no dispositivo</h2>
          <p>Receba avisos mesmo quando o Evolutus estiver fechado.</p>
        </div>
      </header>
      <div className="profile-form">
        {message && <Flash variant={message.variant} role="status">{message.variant === 'success' && <CheckIcon />} {message.text}
          {message.detail && <small className="pwa-muted" style={{ display: 'block' }}>Detalhe técnico: {message.detail}</small>}
        </Flash>}
        {!support.supported && (
          <Flash variant="warning">
            {support.reason === 'ios-install-required'
              ? 'Adicione o Evolutus à Tela de Início e abra o app instalado para ativar notificações.'
              : 'Este navegador não oferece Web Push.'}
          </Flash>
        )}
        {status?.error && (
          <Flash variant="warning">
            Não foi possível verificar o estado deste dispositivo.
            <small className="pwa-muted" style={{ display: 'block' }}>Detalhe técnico: {status.error}</small>
          </Flash>
        )}
        {!status?.thisDevice && status?.activeSubscriptions > 0 && !status?.error && (
          <p className="pwa-muted">As notificações estão ativas em outro dispositivo da sua conta; este ainda não.</p>
        )}
        {permission === 'denied' && (
          <p className="pwa-muted">A permissão está bloqueada. Altere-a nas configurações do navegador.</p>
        )}
        <Button
          type="button"
          variant={active ? 'danger' : 'primary'}
          onClick={active ? disable : enable}
          loading={busy}
          disabled={busy || !support.supported || (!active && permission === 'denied')}
        >
          {active ? 'Desativar neste dispositivo' : 'Ativar notificações'}
        </Button>
      </div>
    </section>
  )
}

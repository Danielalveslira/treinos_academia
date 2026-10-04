import { useEffect, useState } from 'react'
import { BellIcon, CheckIcon } from '@primer/octicons-react'
import { Button, Flash } from '@primer/react'
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushStatus,
  pushSupport,
} from '../services/pushService'

export function PushNotificationSettings() {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const support = pushSupport()
  const permission = typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'

  useEffect(() => {
    let active = true
    getPushStatus().then((value) => active && setStatus(value)).catch(() => active && setStatus({ enabled: false }))
    return () => { active = false }
  }, [])

  async function enable() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await enablePushNotifications()
      if (result.permission === 'granted') {
        setStatus(await getPushStatus())
        setMessage({ variant: 'success', text: 'Notificações ativadas neste dispositivo.' })
      } else if (result.permission === 'denied') {
        setMessage({ variant: 'warning', text: 'Permissão bloqueada. Libere notificações nas configurações do navegador.' })
      }
    } catch (error) {
      setMessage({ variant: 'danger', text: error?.code === 'vapid-not-configured' ? 'Push ainda não foi configurado pelo Evolutus.' : 'Não foi possível ativar notificações.' })
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setMessage(null)
    try {
      await disablePushNotifications()
      setStatus({ enabled: false, activeSubscriptions: 0 })
      setMessage({ variant: 'success', text: 'Notificações desativadas neste dispositivo.' })
    } catch {
      setMessage({ variant: 'danger', text: 'Não foi possível desativar notificações.' })
    } finally {
      setBusy(false)
    }
  }

  const active = status?.enabled && status?.activeSubscriptions > 0
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
        {message && <Flash variant={message.variant} role="status">{message.variant === 'success' && <CheckIcon />} {message.text}</Flash>}
        {!support.supported && (
          <Flash variant="warning">
            {support.reason === 'ios-install-required'
              ? 'Adicione o Evolutus à Tela de Início e abra o app instalado para ativar notificações.'
              : 'Este navegador não oferece Web Push.'}
          </Flash>
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

import { useEffect, useState } from 'react'
import { BellIcon, XIcon } from '@primer/octicons-react'
import { useDevicePush } from '../hooks/useDevicePush'
import { isStandalone } from '../services/pushService'
import {
  dismissPushNotice,
  nextNoticeAt,
  noticeKey,
  readPushNotice,
} from '../utils/pushNoticeSchedule'
import './pushActivationNotice.css'

export function PushActivationNotice({ userId }) {
  const push = useDevicePush(userId)
  const key = noticeKey(userId, isStandalone())
  const [record, setRecord] = useState(() => readPushNotice(key))
  const [now, setNow] = useState(Date.now)
  const [showFeedback, setShowFeedback] = useState(false)
  useEffect(() => {
    if (!push.success && !(push.permission === 'denied' && push.message)) return undefined
    setShowFeedback(true)
    const timer = setTimeout(() => setShowFeedback(false), 8000)
    return () => clearTimeout(timer)
  }, [push.success, push.permission, push.message])
  // Reserve a real card during granted-state verification. It becomes useful status text, never
  // a permanent skeleton or a late inserted invitation that pushes the workout below it.
  const [reserved] = useState(() => push.permission === 'granted' && !push.active)
  const eligible =
    push.allowed &&
    !push.optedOut &&
    push.permission !== 'denied' &&
    (push.support.supported || push.support.reason === 'ios-install-required')
  useEffect(() => {
    if (!eligible) return undefined
    const update = () => {
      setRecord(readPushNotice(key))
      setNow(Date.now())
    }
    const storage = (event) => {
      if (event.key === key || event.key === null) update()
    }
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', update)
    const at = nextNoticeAt(record, now)
    const timer =
      at > now ? setTimeout(update, Math.max(0, Math.min(at - Date.now(), 2147483647))) : null
    return () => {
      clearTimeout(timer)
      window.removeEventListener('storage', storage)
      document.removeEventListener('visibilitychange', update)
    }
  }, [key, record, now, eligible])

  if (
    !push.allowed ||
    push.optedOut ||
    (!push.support.supported && push.support.reason !== 'ios-install-required') ||
    nextNoticeAt(record, now) > now
  )
    return null
  const feedback = showFeedback ? (
    <div className="push-activation-notice push-notice-success" role="status">
      <span className="push-notice-icon" aria-hidden="true">
        <BellIcon size={16} />
      </span>
      <div className="push-notice-body">
        <p>{push.message}</p>
      </div>
    </div>
  ) : null
  if (push.success || push.permission === 'denied') return feedback
  const informational = reserved && push.active
  if (push.active && !reserved) return null
  const installation = push.support.reason === 'ios-install-required'
  return (
    <section
      className={`push-activation-notice${reserved ? ' push-notice-reserved' : ''}`}
      aria-label="Notificações do Evolutus"
    >
      <span className="push-notice-icon" aria-hidden="true">
        <BellIcon size={16} />
      </span>
      <div className="push-notice-body">
        <p>
          {informational
            ? 'Notificações ativas neste dispositivo.'
            : installation
              ? 'No Safari, toque em Compartilhar → Adicionar à Tela de Início. Depois abra o app instalado.'
              : push.failed
                ? 'Não foi possível verificar. Tente ativar novamente.'
                : 'Receba seus lembretes e novidades por aqui.'}
        </p>
        {!informational && !installation && (
          <button
            className="push-notice-enable"
            type="button"
            disabled={push.busy}
            onClick={push.enable}
            title="Ativar notificações neste dispositivo"
          >
            {push.busy ? 'Ativando...' : 'Ativar'}
          </button>
        )}
        {push.message && (
          <p className="push-notice-feedback" role="status">
            {push.message}
          </p>
        )}
      </div>
      <button
        className="push-notice-dismiss"
        type="button"
        aria-label="Dispensar convite para notificações"
        onClick={() => {
          setRecord(dismissPushNotice(key))
          setNow(Date.now())
        }}
      >
        <XIcon size={16} />
      </button>
    </section>
  )
}

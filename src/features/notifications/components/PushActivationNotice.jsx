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

// Convite da Home: só quando o navegador ainda NÃO perguntou (permissão "default") ou quando o iOS
// exige instalar o app. Com a permissão já concedida, a sincronização em segundo plano reinscreve
// o dispositivo e o Perfil é o único lugar de controle: nada de cartão "verificando"/"ativo" aqui.
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
  const installation = push.state === 'install'
  const eligible =
    push.allowed &&
    !push.optedOut &&
    (installation ||
      (push.state === 'inactive' && push.permission === 'default') ||
      push.busy ||
      // Falha da tentativa feita aqui (ex.: serviço Push do Brave desligado): a orientação fica visível.
      (Boolean(push.message) && !push.success && push.state !== 'blocked'))
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

  // Confirmação temporária (fora do fluxo do documento): ativou ou acabou de bloquear.
  if (showFeedback && push.message) {
    return (
      <div className="push-activation-notice push-notice-success" role="status">
        <span className="push-notice-icon" aria-hidden="true">
          <BellIcon size={16} />
        </span>
        <div className="push-notice-body">
          <p>{push.message}</p>
        </div>
      </div>
    )
  }
  if (!eligible || nextNoticeAt(record, now) > now) return null
  return (
    <section className="push-activation-notice" aria-label="Notificações do Evolutus">
      <span className="push-notice-icon" aria-hidden="true">
        <BellIcon size={16} />
      </span>
      <div className="push-notice-body">
        <p>
          {installation
            ? 'Para receber lembretes no iPhone, toque em Compartilhar → Adicionar à Tela de Início e abra o app instalado.'
            : 'Receba lembretes das suas fichas e avisos importantes.'}
        </p>
        {!installation && (
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

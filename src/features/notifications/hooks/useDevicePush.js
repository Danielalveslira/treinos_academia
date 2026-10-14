import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useOnlineStatus } from '../../../hooks/useOnlineStatus'
import { resolveLegalGateState } from '../../../utils/legal'
import {
  disablePushNotifications,
  enablePushNotifications,
  isDevicePushActive,
  getCachedPushDevice,
  isPushOptedOut,
  preparePushNotifications,
  pushErrorMessage,
  pushSupport,
  readPushDevice,
  subscribePushChanges,
} from '../services/pushService'

export function useDevicePush(userId) {
  const auth = useAuth()
  const online = useOnlineStatus()
  const allowed =
    Boolean(userId) &&
    online &&
    !auth.offlineLocal &&
    auth.serverAccessAllowed &&
    !auth.deletionStatus &&
    auth.profile?.accountStatus === 'active' &&
    resolveLegalGateState({
      profile: auth.profile,
      access: auth.legalAccess,
      loading: false,
      error: '',
    }) === 'allowed'
  const [device, setDevice] = useState(() => {
    const cached = getCachedPushDevice(userId)
    return cached ? { ...cached, userId } : null
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const lifetime = useRef(0)
  const inFlight = useRef(false)
  const [version, setVersion] = useState(0)
  const support = pushSupport()
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  const optedOut = isPushOptedOut(userId)

  useEffect(() => {
    const generation = ++lifetime.current
    if (!allowed)
      return () => {
        lifetime.current += 1
      }
    let lastPermission =
      typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    const refresh = () => {
      if (!allowed) return
      preparePushNotifications()
      readPushDevice({ userId })
        .then((value) => {
          if (lifetime.current === generation) {
            setDevice({ ...value, userId })
            setFailed(false)
          }
        })
        .catch(() => {
          if (lifetime.current === generation) setFailed(true)
        })
    }
    const visible = () => {
      if (document.visibilityState !== 'visible') return
      const current = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
      if (current !== lastPermission) {
        lastPermission = current
        setVersion((v) => v + 1)
      }
      refresh()
    }
    const unsubscribe = subscribePushChanges(refresh)
    refresh()
    document.addEventListener('visibilitychange', visible)
    return () => {
      lifetime.current += 1
      unsubscribe()
      document.removeEventListener('visibilitychange', visible)
    }
  }, [allowed, userId, version])

  function act(disable = false) {
    if (!allowed || inFlight.current) return
    inFlight.current = true
    const generation = lifetime.current
    setBusy(true)
    setMessage('')
    // Do not await anything before the service starts the native permission request.
    const operation = disable
      ? disablePushNotifications({ explicit: true, userId })
      : enablePushNotifications({ userId })
    operation
      .then((result) => {
        if (lifetime.current !== generation) return
        if (disable) {
          setDevice(null)
          setMessage('Notificações desativadas neste dispositivo.')
        } else if (result.permission === 'granted') {
          setDevice({
            support,
            permission: 'granted',
            endpoint: result.subscription.endpoint,
            status: result.status,
            userId,
          })
          setMessage('Notificações ativadas neste dispositivo.')
        } else {
          setMessage(
            result.permission === 'denied'
              ? 'Permissão bloqueada. Libere notificações nas configurações do navegador.'
              : 'A permissão não foi concedida. Você pode tentar novamente.'
          )
        }
      })
      .catch((error) => {
        if (lifetime.current === generation) setMessage(pushErrorMessage(error))
      })
      .finally(() => {
        inFlight.current = false
        if (lifetime.current === generation) {
          setBusy(false)
          setVersion((v) => v + 1)
        }
      })
  }
  const current = device?.userId === userId ? device : null
  return {
    allowed,
    support,
    permission,
    optedOut,
    busy,
    message,
    failed,
    device: current,
    active: Boolean(
      !optedOut && current && isDevicePushActive({ ...current, permission }, current.status)
    ),
    enable: () => act(),
    disable: () => act(true),
  }
}

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import { registerQualifiedActivity } from '../services/economyService'

const MIN_PING_INTERVAL_MS = 3 * 60 * 1000

// Sinaliza "atividade real" ao trocar de rota (navegação de verdade, não uma aba
// parada aberta -- ver seção 9 do prompt de economia). O servidor é sempre quem decide
// quantos minutos isso vale (activity-core.js); este throttle é só para não bater na
// Function a cada clique. grantedTodayRef vive só enquanto o app está aberto nesta aba:
// perder esse estado num reload apenas custa, no pior caso, mais uma chamada barata (a
// própria Function já responde granted:false sem gravar nada quando o dia já foi
// premiado -- ver activity-core.js: already_granted).
export function useQualifiedActivity() {
  const { user, profile } = useAuth()
  const { pathname } = useLocation()
  const lastPingRef = useRef(0)
  const grantedTodayRef = useRef(false)

  useEffect(() => {
    if (!user || !profile || grantedTodayRef.current) return
    const now = Date.now()
    if (now - lastPingRef.current < MIN_PING_INTERVAL_MS) return
    lastPingRef.current = now
    registerQualifiedActivity(user.uid)
      .then((result) => {
        if (result?.granted) grantedTodayRef.current = true
      })
      .catch(() => {}) // best-effort: nunca deveria interromper a navegação por causa disto
  }, [pathname, user, profile])
}

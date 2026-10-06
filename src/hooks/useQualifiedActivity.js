import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import { registerQualifiedActivity } from '../services/economyService'
import { isDayActivityComplete, saoPauloDayKey } from '../utils/qualifiedActivity'

const MIN_PING_INTERVAL_MS = 3 * 60 * 1000

// Sinaliza "atividade real" ao trocar de rota (navegação de verdade, não uma aba
// parada aberta -- ver seção 9 do prompt de economia). O servidor é sempre quem decide
// quantos minutos isso vale (activity-core.js); este throttle é só para não bater na
// Function a cada clique. completedDayRef vive só enquanto o app está aberto nesta aba:
// perder esse estado num reload apenas custa, no pior caso, mais uma chamada barata (a
// própria Function já responde granted:false sem gravar nada quando o dia já foi
// premiado -- ver activity-core.js: already_granted).
//
// Só para de pingar no dia quando a recompensa saiu E o dia já virou "dia ativo" no
// servidor (resposta dayQualified) -- a criação de comunidade conta esses dias, e a
// recompensa pode sair antes do mínimo de atividade deles. A marca é por dia (fuso do
// servidor): uma aba aberta de um dia para o outro volta a pingar na virada.
export function useQualifiedActivity() {
  const { user, profile, offlineLocal } = useAuth()
  const { pathname } = useLocation()
  const lastPingRef = useRef(0)
  const completedDayRef = useRef(null)

  useEffect(() => {
    if (!user || !profile || offlineLocal || completedDayRef.current === saoPauloDayKey()) return
    const now = Date.now()
    if (now - lastPingRef.current < MIN_PING_INTERVAL_MS) return
    lastPingRef.current = now
    const dayKey = saoPauloDayKey()
    registerQualifiedActivity()
      .then((result) => {
        if (isDayActivityComplete(result)) completedDayRef.current = dayKey
      })
      .catch(() => {}) // best-effort: nunca deveria interromper a navegação por causa disto
  }, [pathname, user, profile, offlineLocal])
}

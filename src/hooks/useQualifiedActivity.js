import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import { registerQualifiedActivity } from '../services/economyService'
import { isDayActivityComplete, saoPauloDayKey } from '../utils/qualifiedActivity'

const MIN_PING_INTERVAL_MS = 3 * 60 * 1000
// Sem interação real há mais que isto, a aba está só aberta (ou o usuário saiu do computador):
// para de pingar até algo acontecer de novo. Maior que MIN_PING_INTERVAL_MS de propósito -- uma
// pausa curta de leitura entre dois pings legítimos não deve ser tratada como ausência.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
// Verificação local (sem rede) -- decide SE vale a pena pingar, não quando pingar de fato (isso
// ainda é MIN_PING_INTERVAL_MS). Só roda enquanto a aba está visível (ver handleVisibilityChange).
const TICK_INTERVAL_MS = 60 * 1000
// Qualquer uma destas prova uso real da tela atual -- nenhuma delas exige trocar de rota.
// mousemove fica de fora de propósito: dispara sozinho em telas touch/trackpad sem gesto do
// usuário em alguns navegadores, e um clique/toque/tecla/scroll real já é sinal suficiente.
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']

// Sinaliza "atividade real" com dois sinais independentes: trocar de rota (navegação de
// verdade) E qualquer interação na tela atual (clique, tecla, scroll, toque) enquanto a aba
// está visível -- ver seção 9 do prompt de economia. Antes, só a troca de rota contava, o que
// subestimava quem fica numa única tela (lendo um treino, revisando um post longo etc.). O
// SERVIDOR é sempre quem decide quantos minutos isso vale e se o padrão de checkpoints basta
// para pagar a recompensa (activity-core.js / private.record_activity_checkpoint); nada aqui
// prova presença humana, e automação que simule estes mesmos eventos do navegador não é
// impossível -- só mais cara de forjar do que esperar passivamente, que é o que esta troca evita.
//
// Dois motivos pararam de pingar, e os dois têm que estar ausentes para voltar a pingar:
//   - ausência de interação por mais de IDLE_TIMEOUT_MS: aba aberta sem ninguém usando;
//   - aba oculta (document.visibilityState !== 'visible'): outra aba em foco, app minimizado.
// Isto também cobre múltiplas abas sem nenhuma lógica extra: cada aba só pinga enquanto está
// em foco E em uso, então não há duas abas pingando "tempo" ao mesmo tempo pela mesma pessoa; e
// mesmo que houvesse, o servidor agrega por usuário/dia com o mesmo intervalo real entre
// checkpoints (ver 20261124000001_finance_activity_reward_fix.sql) -- não é o cliente que soma.
//
// completedDayRef vive só enquanto o app está aberto nesta aba: perder esse estado num reload
// apenas custa, no pior caso, mais uma chamada barata (a própria Function já responde
// granted:false sem gravar nada quando o dia já foi premiado -- ver activity-core.js:
// already_granted). O intervalo local (TICK_INTERVAL_MS) nunca bate na rede por si só -- só
// decide quando VALE a pena tentar; a chamada de verdade continua limitada a
// MIN_PING_INTERVAL_MS, e para de rodar enquanto a aba está oculta (sem polling em background).
//
// Só para de pingar no dia quando a recompensa saiu E o dia já virou "dia ativo" no servidor
// (resposta dayQualified) -- a criação de comunidade conta esses dias, e a recompensa pode sair
// antes do mínimo de atividade deles. A marca é por dia (fuso do servidor): uma aba aberta de um
// dia para o outro volta a pingar na virada.
export function useQualifiedActivity() {
  const { user, profile, offlineLocal } = useAuth()
  const { pathname } = useLocation()
  const lastPingRef = useRef(0)
  const lastInteractionRef = useRef(0)
  const completedDayRef = useRef(null)

  // Navegar é, em si, uma interação real -- conta mesmo sem nenhum clique/tecla/scroll extra.
  useEffect(() => {
    lastInteractionRef.current = Date.now()
  }, [pathname])

  useEffect(() => {
    if (!user || !profile || offlineLocal) return

    // Troca de conta sem desmontar o componente (login/logout, trocar de perfil) muda user/profile
    // por referência e cai aqui de novo -- sem este reset, os refs ficariam com o estado da conta
    // ANTERIOR: lastPingRef adiado atrasaria o primeiro ping da conta nova, lastInteractionRef
    // emprestaria presença de quem já saiu, e completedDayRef poderia bloquear o dia da conta nova
    // só porque a ANTERIOR já tinha sido premiada hoje. O SERVIDOR sempre decide pelo auth.uid()
    // da sessão atual -- isto é só o estado local de throttling, mas ele tem que ser por conta.
    lastPingRef.current = 0
    lastInteractionRef.current = Date.now()
    completedDayRef.current = null

    const markInteraction = () => {
      lastInteractionRef.current = Date.now()
    }

    const ping = () => {
      if (completedDayRef.current === saoPauloDayKey()) return
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastInteractionRef.current > IDLE_TIMEOUT_MS) return
      if (now - lastPingRef.current < MIN_PING_INTERVAL_MS) return
      lastPingRef.current = now
      const dayKey = saoPauloDayKey()
      registerQualifiedActivity()
        .then((result) => {
          if (isDayActivityComplete(result)) completedDayRef.current = dayKey
        })
        .catch(() => {}) // best-effort: nunca deveria interromper a navegação por causa disto
    }

    let intervalId = null
    const startTicking = () => {
      if (intervalId !== null) return
      intervalId = setInterval(ping, TICK_INTERVAL_MS)
    }
    const stopTicking = () => {
      if (intervalId === null) return
      clearInterval(intervalId)
      intervalId = null
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        markInteraction() // voltar a esta aba é, em si, reengajar
        startTicking()
      } else {
        stopTicking() // oculta: nenhum trabalho em segundo plano por esta aba
      }
    }

    INTERACTION_EVENTS.forEach((type) => window.addEventListener(type, markInteraction, { passive: true }))
    document.addEventListener('visibilitychange', handleVisibilityChange)
    if (document.visibilityState === 'visible') startTicking()

    return () => {
      INTERACTION_EVENTS.forEach((type) => window.removeEventListener(type, markInteraction))
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopTicking()
    }
  }, [user, profile, offlineLocal])
}

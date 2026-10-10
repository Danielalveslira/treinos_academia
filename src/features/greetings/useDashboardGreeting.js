import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDashboardGreeting } from '../../utils/greeting'
import { acknowledgeGreetingWelcome } from '../../services/greetingPreferencesService'
import { GREETING_V2_ENABLED } from './config'
import { buildGreetingContext, resolveFirstName } from './context'
import { greetingFromContext } from './select'
import { acknowledgeWelcomeOnce } from './welcome'

// Hook fino, SEM leitura remota: só interpreta o que a Home e o AuthContext já carregaram.
//  - `enabled` falso => saudação anterior (utils/greeting.js), sem RPC nova;
//  - as boas-vindas ficam TRAVADAS (latch) assim que o cabeçalho é desenhado: o ACK do servidor não troca a
//    frase no meio da leitura; só um estado de maior prioridade (treino concluído/em andamento) a substitui;
//  - o ACK é uma escrita única, online, depois de a frase estar visível (ver DashboardGreeting).
export function useDashboardGreeting({
  profile,
  user,
  offlineLocal = false,
  todayState,
  reminderDue = false,
  daysSinceLastActivity = null,
  hasActivityData = true,
  now,
  onWelcomeAcknowledged,
  enabled = GREETING_V2_ENABLED,
  welcomeCutoffMs, // só para teste: o padrão vem da config de build
}) {
  const userId = user?.uid ?? null
  const [latchedFor, setLatchedFor] = useState(null)
  const welcomeLatched = userId != null && latchedFor === userId
  const welcomeSeenAt = profile?.greetingWelcomeSeenAt
  const rawName = resolveFirstName({ profile, user })

  const context = useMemo(
    () =>
      enabled
        ? buildGreetingContext({
            username: profile?.username,
            firstName: rawName,
            sexo: profile?.sexo,
            greetingVoice: profile?.greetingVoice,
            createdAt: profile?.createdAt,
            accountStatus: profile?.accountStatus,
            welcomeSeenAt,
            welcomeLatched,
            welcomeCutoffMs,
            todayState,
            reminderDue,
            daysSinceLastActivity,
            hasActivityData,
            offlineLocal,
            now,
          })
        : null,
    [
      enabled,
      profile?.username,
      rawName,
      profile?.sexo,
      profile?.greetingVoice,
      profile?.createdAt,
      profile?.accountStatus,
      welcomeSeenAt,
      welcomeLatched,
      welcomeCutoffMs,
      todayState,
      reminderDue,
      daysSinceLastActivity,
      hasActivityData,
      offlineLocal,
      now,
    ]
  )

  const greeting = useMemo(
    () =>
      context
        ? greetingFromContext(context, userId)
        : getDashboardGreeting({
            firstName: rawName,
            todayState,
            reminderDue,
            daysSinceLastActivity,
            now,
            uid: user?.uid,
          }),
    [context, userId, rawName, todayState, reminderDue, daysSinceLastActivity, now, user?.uid]
  )

  // O componente avisa quando a frase de boas-vindas está de fato na tela (e a aba visível).
  const isWelcome = Boolean(context) && greeting.isWelcome
  const onShown = useCallback(() => {
    if (isWelcome && userId) setLatchedFor(userId)
  }, [isWelcome, userId])

  // Quem recebe o resultado muda de identidade a cada render do AuthProvider: fica em ref para o efeito do
  // ACK não reiniciar (e reenviar) por isso.
  const acknowledgedRef = useRef(onWelcomeAcknowledged)
  useEffect(() => {
    acknowledgedRef.current = onWelcomeAcknowledged
  })

  const mustAcknowledge =
    enabled && welcomeLatched && !offlineLocal && welcomeSeenAt === null && userId != null
  useEffect(() => {
    if (!mustAcknowledge) return undefined
    const attempt = () => {
      if (globalThis.navigator?.onLine === false) return
      acknowledgeWelcomeOnce(userId, acknowledgeGreetingWelcome)
        .then((seenAt) => {
          if (seenAt) acknowledgedRef.current?.(userId, seenAt)
        })
        .catch(() => {
          // Sem retry em laço: a próxima tentativa é a volta da rede ou uma nova entrada na Home.
        })
    }
    attempt()
    window.addEventListener('online', attempt)
    return () => window.removeEventListener('online', attempt)
  }, [mustAcknowledge, userId])

  return { greeting, onShown }
}

import { useEffect, useState } from 'react'
import { clockSignature, msUntilNextGreetingChange } from './clock'

// Devolve um `now` que só muda quando algo relevante para a frase mudou (virada do dia de negócio, período
// local, horário do lembrete). UM setTimeout até a próxima fronteira -- sem setInterval nem polling -- e
// reavaliação ao voltar para o app (timers ficam pausados em segundo plano).
export function useGreetingClock({ enabled = true, preferences } = {}) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!enabled) return undefined
    let timer
    const sync = () => {
      clearTimeout(timer)
      const current = new Date()
      const signature = clockSignature(preferences, current)
      setNow((previous) =>
        clockSignature(preferences, previous) === signature ? previous : current
      )
      timer = setTimeout(sync, msUntilNextGreetingChange(preferences, current))
    }
    const onResume = () => {
      if (document.visibilityState === 'visible') sync()
    }
    sync()
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('pageshow', onResume)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('pageshow', onResume)
    }
  }, [enabled, preferences])

  return now
}

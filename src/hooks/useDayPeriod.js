import { useEffect, useState } from 'react'
import { getDayPeriod, msUntilNextPeriod } from '../utils/dayPeriod'

// 'day' | 'night' pelo relógio local. Um único timeout até a próxima virada (nada de polling); ao voltar para a
// aba/app (visibilitychange) reavalia, porque timers são pausados em segundo plano.
export function useDayPeriod() {
  const [period, setPeriod] = useState(() => getDayPeriod())

  useEffect(() => {
    let timer
    const sync = () => {
      clearTimeout(timer)
      setPeriod(getDayPeriod())
      timer = setTimeout(sync, msUntilNextPeriod())
    }
    const onVisible = () => document.visibilityState === 'visible' && sync()
    sync()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return period
}

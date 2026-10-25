import { useEffect, useState } from 'react'
import { businessDayKey, msUntilNextBusinessDay } from '../../utils/businessDate.js'
import { dailyRotationIndex } from './dailyRotation.js'
import { DASHBOARD_BANNER_PHOTOS } from './dashboardBanners.js'

// A foto do painel da Home muda sozinha na virada do dia de negócio (America/Sao_Paulo), sem
// recarregar a página: UM setTimeout até a próxima meia-noite -- sem setInterval, sem polling -- e
// reavaliação ao voltar para o app (abas em segundo plano pausam timers; o celular pode ter dormido
// atravessando a virada). Mesmo mecanismo de features/greetings/useGreetingClock.js.
export function useDailyBanner(photos = DASHBOARD_BANNER_PHOTOS) {
  const [dayKey, setDayKey] = useState(() => businessDayKey())

  useEffect(() => {
    let timer
    const sync = () => {
      clearTimeout(timer)
      const now = new Date()
      const next = businessDayKey(now)
      setDayKey((previous) => (previous === next ? previous : next))
      timer = setTimeout(sync, msUntilNextBusinessDay(now))
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
  }, [])

  if (!photos?.length) return null
  return photos[dailyRotationIndex(dayKey, photos.length)]
}

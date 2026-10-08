import { useCallback, useMemo } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import { listWorkoutsPage } from '../services/workoutsService'
import { listProgressDays } from '../services/progressService'
import { persistHomeSnapshot } from '../services/offline/snapshotWriter'
import { getActivityRange } from '../utils/activityCalendar'
import { businessDayKey } from '../utils/businessDate'
import { overlayLocalProgressDays } from '../utils/progressOverlay'

const EMPTY = []
const RECENT_PAGE_SIZE = 50

// Home offline: a atividade vem do snapshot gravado da última vez que a Home carregou ONLINE, com os treinos
// registrados desde então (locais/outbox) sobrepostos. Sem snapshot NÃO há atividade conhecida: devolve
// `progressAvailable: false` para a tela mostrar "—" em vez de um 0 que pareça dado real.
function offlineProgressDays(offlineHome, recentWorkouts) {
  const progress = offlineHome?.progress
  if (!progress) return null
  return overlayLocalProgressDays(progress.days, recentWorkouts, {
    sinceDayKey: businessDayKey(new Date(progress.saved_at)),
    afterDayKey:
      recentWorkouts.length >= RECENT_PAGE_SIZE
        ? String(recentWorkouts[recentWorkouts.length - 1].date).slice(0, 10)
        : null,
  })
}

export function useHomeDashboard() {
  const { user, offlineLocal, offlineHome } = useAuth()
  const { start, end, year } = getActivityRange()
  const fetchValue = useCallback(async () => {
    const [workoutPage, progressDays] = await Promise.all([
      listWorkoutsPage(user.uid, { pageSize: RECENT_PAGE_SIZE, localOnly: offlineLocal }),
      offlineLocal ? Promise.resolve(null) : listProgressDays(user.uid, start, end),
    ])
    if (!offlineLocal) {
      // Dado ONLINE confirmado pelo servidor: vira o snapshot que o próximo cold start offline restaura.
      persistHomeSnapshot(user.uid, { progress: { start, end, days: progressDays } })
      return { recentWorkouts: workoutPage.items, progressDays, progressAvailable: true }
    }
    const offlineDays = offlineProgressDays(offlineHome, workoutPage.items)
    return {
      recentWorkouts: workoutPage.items,
      progressDays: offlineDays ?? EMPTY,
      progressAvailable: offlineDays != null,
    }
  }, [user.uid, start, end, offlineLocal, offlineHome])
  const { data, loading, error, refresh } = useCachedQuery(
    `home:${user.uid}:${year}:${offlineLocal ? 'local' : 'online'}`,
    fetchValue,
    { keepPreviousScope: `${user.uid}:${year}` }
  )
  return useMemo(
    () => ({
      recentWorkouts: data?.recentWorkouts || EMPTY,
      progressDays: data?.progressDays || EMPTY,
      // Enquanto carrega (ou online) a atividade é "disponível"; só o offline SEM snapshot é indisponível.
      progressAvailable: data ? data.progressAvailable : true,
      loading,
      error,
      refresh,
    }),
    [data, loading, error, refresh]
  )
}

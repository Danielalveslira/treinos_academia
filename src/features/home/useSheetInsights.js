import { useCallback, useMemo } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useCachedQuery } from '../../hooks/useCachedQuery.js'
import { useWorkoutSheets } from '../workoutSheets/useWorkoutSheets.js'
import { listSheetActivitySince } from '../../services/workoutsService.js'
import { businessDayKey, businessDayKeyDaysAgo } from '../../utils/businessDate.js'
import {
  buildSheetActivityIndex,
  lastTrainedSheet,
  mostTrainedThisMonth,
  recommendSheet,
} from './recommendSheet.js'

const EMPTY = []
// Cobre o mês corrente inteiro + uma folga de recência para "última execução" mesmo quando o mês
// começou há poucos dias -- poucas linhas (sheet_id, date), uma única consulta (ver workoutsService).
const ACTIVITY_WINDOW_DAYS = 60

// Painel "Próxima ficha recomendada" da Home: reaproveita o MESMO hook/serviço de leitura de
// fichas usado por Fichas/Treinar (useWorkoutSheets) -- nenhuma segunda implementação. A
// recomendação já exige servidor (como o resto da área de fichas); offline, o painel mostra um
// aviso honesto em vez de inventar uma sugestão a partir de dados desatualizados.
export function useSheetInsights() {
  const { user } = useAuth()
  const {
    data: sheets,
    loading: sheetsLoading,
    error: sheetsError,
    online,
    refresh: refreshSheets,
  } = useWorkoutSheets(null, false, false, 0)
  const todayKey = businessDayKey()
  const sinceKey = businessDayKeyDaysAgo(ACTIVITY_WINDOW_DAYS)
  const monthStartKey = `${todayKey.slice(0, 7)}-01`

  const fetchActivity = useCallback(
    () => listSheetActivitySince(user.uid, sinceKey),
    [user.uid, sinceKey]
  )
  const activity = useCachedQuery(`home-sheet-activity:${user.uid}:${sinceKey}`, fetchActivity, {
    enabled: online,
    keepPreviousScope: user.uid,
  })

  const activityIndex = useMemo(
    () => buildSheetActivityIndex(activity.data || EMPTY, monthStartKey),
    [activity.data, monthStartKey]
  )
  const list = sheets || EMPTY
  const recommendation = useMemo(
    () => recommendSheet(list, activityIndex, todayKey),
    [list, activityIndex, todayKey]
  )
  const lastTrained = useMemo(() => lastTrainedSheet(list, activityIndex), [list, activityIndex])
  const mostTrained = useMemo(
    () => mostTrainedThisMonth(list, activityIndex),
    [list, activityIndex]
  )

  function refresh() {
    refreshSheets()
    activity.refresh()
  }

  return {
    online,
    loading: sheetsLoading || (online && activity.loading),
    error: sheetsError || (online ? activity.error : null),
    hasSheets: list.length > 0,
    recommendation,
    lastTrained,
    mostTrained,
    refresh,
  }
}

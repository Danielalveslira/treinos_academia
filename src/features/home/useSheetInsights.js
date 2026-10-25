import { useCallback, useMemo } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useCachedQuery } from '../../hooks/useCachedQuery.js'
import { getSheetInsights } from '../../services/workoutsService.js'
import { businessDayKey } from '../../utils/businessDate.js'
import {
  buildSheetActivityIndex,
  lastTrainedSheet,
  mostTrainedThisMonth,
  recommendSheet,
} from './recommendSheet.js'

const EMPTY = []
export function useSheetInsights() {
  const { user, offlineLocal } = useAuth()
  const connected = useOnlineStatus()
  const online = connected && !offlineLocal
  const todayKey = businessDayKey()
  const fetchActivity = useCallback(() => getSheetInsights(), [])
  const activity = useCachedQuery(`home-sheet-activity:${user.uid}:${todayKey}`, fetchActivity, {
    enabled: online,
    keepPreviousScope: user.uid,
    observeInvalidation: true,
  })
  const list = activity.data?.sheets || EMPTY
  const activityIndex = useMemo(
    () =>
      buildSheetActivityIndex(
        list.map((s) => ({
          sheetId: s.id,
          date: s.last_date,
          monthDays: s.month_days,
          lastRegisteredAt: s.last_registered_at,
        })),
        `${todayKey.slice(0, 7)}-01`
      ),
    [list, todayKey]
  )
  const recommendation = useMemo(
    () => recommendSheet(list, activityIndex, todayKey),
    [list, activityIndex, todayKey]
  )
  return {
    online,
    loading: online && activity.loading,
    error: activity.error,
    hasSheets: list.length > 0,
    recommendation,
    lastTrained: lastTrainedSheet(list, activityIndex),
    mostTrained: mostTrainedThisMonth(list, activityIndex),
    refresh: activity.refresh,
  }
}

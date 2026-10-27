import { fetchCached } from '../../utils/pageCache.js'
import { businessDayKey } from '../../utils/businessDate.js'
import { getSheetInsights } from '../../services/workoutsService.js'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import {
  readSheetSnapshots,
  saveSheetSnapshot,
  invalidateSheetSnapshots,
} from '../../services/offline/sheetSnapshot.js'
import { sheetSnapshotInvalidation } from './sheetReadPolicy.js'
import {
  getSheetInsightsForExercise,
  getWorkoutSheet,
  listWorkoutSheets,
} from './workoutSheetsService.js'
export function useWorkoutSheets(
  id = null,
  execution = false,
  archived = false,
  page = 0,
  exerciseId = null
) {
  const { user, offlineLocal } = useAuth()
  const online = useOnlineStatus()
  const key = `${user.uid}:${id || 'list'}:${execution}:${online}:${offlineLocal}:${archived}:${page}:${exerciseId || ''}`
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({})
  useEffect(() => {
    let active = true
    const startedAt = Date.now()
    setState({ key, loading: true })
    const request =
      !online || offlineLocal
        ? readSheetSnapshots(user.uid).then((sheets) => {
            if (id) {
              const sheet = sheets.find((sheet) => sheet.id === id)
              if (!sheet) throw new Error('SHEET_NETWORK_REQUIRED')
              return sheet
            }
            return sheets
              .filter(
                (sheet) =>
                  !exerciseId ||
                  sheet.items.some((item) => item.exercise_id === exerciseId && item.available)
              )
              .map((sheet) => ({
                ...sheet,
                exercise_count: sheet.items.length,
                available: true,
              }))
          })
        : id
          ? getWorkoutSheet(id, execution)
          : execution === 'picker'
            ? fetchCached(
                exerciseId
                  ? `home-sheet-activity:${user.uid}:${businessDayKey()}:exercise:${exerciseId}`
                  : `home-sheet-activity:${user.uid}:${businessDayKey()}`,
                exerciseId ? () => getSheetInsightsForExercise(exerciseId) : getSheetInsights,
                {
                  force: attempt > 0,
                }
              ).then((result) => result.sheets)
            : listWorkoutSheets(archived, page)
    request.then(
      async (data) => {
        if (active && online && !offlineLocal && id && execution)
          await saveSheetSnapshot(user.uid, data, startedAt)
        if (active) setState({ key, data, loading: false })
      },
      async (error) => {
        const invalidation = sheetSnapshotInvalidation(error, id)
        if (active && online && id && execution && invalidation !== undefined)
          await invalidateSheetSnapshots(user.uid, invalidation)
        if (active) setState({ key, error, loading: false })
      }
    )
    return () => {
      active = false
    }
  }, [key, id, execution, attempt, online, offlineLocal, archived, page, user.uid, exerciseId])
  const refresh = useCallback(() => setAttempt((n) => n + 1), [])
  return {
    ...(state.key === key ? state : { loading: true }),
    refresh,
    online: online && !offlineLocal,
  }
}

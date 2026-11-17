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
              if (execution && sheet.items.some((item) => item.exercise.typeMismatch))
                throw new Error('SHEET_NOT_READY')
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
                available: sheet.items.every(
                  (item) => item.available && !item.exercise.typeMismatch
                ),
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
        if (active && online && !offlineLocal && id) {
          const saved = await saveSheetSnapshot(user.uid, data, startedAt)
          if (!saved) await invalidateSheetSnapshots(user.uid, id)
        }
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
  useEffect(() => {
    if (!online || offlineLocal || typeof document === 'undefined') return undefined
    let lastCheck = Date.now()
    const revalidate = () => {
      if (globalThis.navigator?.onLine === false || document.visibilityState === 'hidden') return
      if (Date.now() - lastCheck < 5 * 60 * 1000) return
      lastCheck = Date.now()
      refresh()
    }
    document.addEventListener('visibilitychange', revalidate)
    return () => document.removeEventListener('visibilitychange', revalidate)
  }, [online, offlineLocal, refresh])
  return {
    ...(state.key === key ? state : { loading: true }),
    refresh,
    online: online && !offlineLocal,
  }
}

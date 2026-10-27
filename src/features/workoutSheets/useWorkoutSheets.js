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
import { getWorkoutSheet, listWorkoutSheets } from './workoutSheetsService.js'
export function useWorkoutSheets(id = null, execution = false, archived = false, page = 0) {
  const { user, offlineLocal } = useAuth()
  const online = useOnlineStatus()
  const key = `${user.uid}:${id || 'list'}:${execution}:${online}:${offlineLocal}:${archived}:${page}`
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
            return sheets.map((sheet) => ({
              ...sheet,
              exercise_count: sheet.items.length,
              available: true,
            }))
          })
        : id
          ? getWorkoutSheet(id, execution)
          : execution === 'picker'
            ? fetchCached(`home-sheet-activity:${user.uid}:${businessDayKey()}`, getSheetInsights, {
                force: attempt > 0,
              }).then((result) => result.sheets)
            : listWorkoutSheets(archived, page)
    request.then(
      async (data) => {
        if (active && online && !offlineLocal && id && execution)
          await saveSheetSnapshot(user.uid, data, startedAt)
        if (active) setState({ key, data, loading: false })
      },
      async (error) => {
        if (active && online && id && execution) await invalidateSheetSnapshots(user.uid)
        if (active) setState({ key, error, loading: false })
      }
    )
    return () => {
      active = false
    }
  }, [key, id, execution, attempt, online, offlineLocal, archived, page, user.uid])
  const refresh = useCallback(() => setAttempt((n) => n + 1), [])
  return {
    ...(state.key === key ? state : { loading: true }),
    refresh,
    online: online && !offlineLocal,
  }
}

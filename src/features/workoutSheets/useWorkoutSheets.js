import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { getWorkoutSheet, listWorkoutSheets } from './workoutSheetsService.js'
export function useWorkoutSheets(id = null, execution = false, archived = false, page = 0) {
  const { user, offlineLocal } = useAuth()
  const online = useOnlineStatus()
  const key = `${user.uid}:${id || 'list'}:${execution}:${online}:${offlineLocal}:${archived}:${page}`
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({})
  useEffect(() => {
    let active = true
    setState({ key, loading: true })
    const request =
      !online || offlineLocal
        ? Promise.reject(new Error('SHEET_NETWORK_REQUIRED'))
        : id
          ? getWorkoutSheet(id, execution)
          : listWorkoutSheets(archived, page)
    request.then(
      (data) => {
        if (active) setState({ key, data, loading: false })
      },
      (error) => {
        if (active) setState({ key, error, loading: false })
      }
    )
    return () => {
      active = false
    }
  }, [key, id, execution, attempt, online, offlineLocal, archived, page])
  const refresh = useCallback(() => setAttempt((n) => n + 1), [])
  return {
    ...(state.key === key ? state : { loading: true }),
    refresh,
    online: online && !offlineLocal,
  }
}

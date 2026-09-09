import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { listDashboardWorkouts, countWorkouts } from '../services/workoutsService'
import { describeFirestoreError } from '../utils/firestoreError'

export function useDashboard() {
  const { user } = useAuth()
  const [recentWorkouts, setRecentWorkouts] = useState([])
  const [allWorkouts, setAllWorkouts] = useState([])
  const [totalWorkouts, setTotalWorkouts] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // listDashboardWorkouts é limitado a uma janela recente (streak/frequência não
      // precisam do histórico completo); countWorkouts usa agregação no servidor, então
      // o total exibido continua exato mesmo com o histórico distante fora da janela.
      const [workouts, total] = await Promise.all([
        listDashboardWorkouts(user.uid),
        countWorkouts(user.uid),
      ])
      setRecentWorkouts(workouts.slice(0, 50))
      setAllWorkouts(workouts)
      setTotalWorkouts(total)
    } catch (err) {
      setError(describeFirestoreError(err, 'useDashboard'))
    } finally {
      setLoading(false)
    }
  }, [user.uid])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { recentWorkouts, allWorkouts, totalWorkouts, loading, error, refresh }
}

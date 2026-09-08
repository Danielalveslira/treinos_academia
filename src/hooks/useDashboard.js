import { useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { listRecentWorkouts, countWorkouts } from '../services/workoutsService'

const RECENT_WINDOW_SIZE = 50

export function useDashboard() {
  const { user } = useAuth()
  const [recentWorkouts, setRecentWorkouts] = useState([])
  const [totalWorkouts, setTotalWorkouts] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError('')
      try {
        const [workouts, total] = await Promise.all([
          listRecentWorkouts(user.uid, RECENT_WINDOW_SIZE),
          countWorkouts(user.uid),
        ])
        if (active) {
          setRecentWorkouts(workouts)
          setTotalWorkouts(total)
        }
      } catch {
        if (active) setError('Não foi possível carregar o dashboard.')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [user.uid])

  return { recentWorkouts, totalWorkouts, loading, error }
}

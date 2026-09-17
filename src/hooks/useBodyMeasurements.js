import { useCallback } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import { listRecentMeasurements } from '../services/bodyMeasurementsService'

const EMPTY = []
export function useBodyMeasurements() {
  const { user } = useAuth()
  const fetchValue = useCallback(() => listRecentMeasurements(user.uid), [user.uid])
  const { data, loading, error, refresh } = useCachedQuery(
    `bodyMeasurements:${user.uid}`,
    fetchValue
  )
  return {
    measurements: data?.items || EMPTY,
    truncated: data?.truncated || false,
    loading,
    error,
    refresh,
  }
}

import { useCallback } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import { listRecentMeasurements } from '../services/bodyMeasurementsService'
import { getCached } from '../utils/pageCache'

const EMPTY = []
export function useBodyMeasurements() {
  const { user, offlineLocal } = useAuth()
  const key = `bodyMeasurements:${user.uid}`
  const fetchValue = useCallback(() => listRecentMeasurements(user.uid), [user.uid])
  const { data, loading, error, refresh } = useCachedQuery(key, fetchValue, {
    enabled: !offlineLocal,
    observeInvalidation: true,
  })
  const shown = offlineLocal ? getCached(key) : data
  return {
    measurements: shown?.items || EMPTY,
    truncated: shown?.truncated || false,
    loading,
    error,
    refresh,
    offline: offlineLocal,
    available: !offlineLocal || shown !== undefined,
  }
}

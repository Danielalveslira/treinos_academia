import { useCallback } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import { getProgressSheetSummary } from '../services/progressService'

export function useProgressSheetSummary(start, end) {
  const { user, offlineLocal } = useAuth()
  const fetchValue = useCallback(() => getProgressSheetSummary(start, end), [start, end])
  return useCachedQuery(`progress:${user.uid}:sheets:${start}:${end}`, fetchValue, {
    enabled: !offlineLocal,
    observeInvalidation: true,
  })
}

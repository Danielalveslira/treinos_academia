import { useCallback, useEffect, useState } from 'react'
import {
  getBillingConfig,
  subscribeBillingConfig,
  invalidateBillingConfig,
} from '../services/billingService'
import { DEFAULT_BILLING_CONFIG } from '../utils/billing'
import { useAuth } from './useAuth'

export function useBillingConfig() {
  const { user } = useAuth()
  const [config, setConfig] = useState(DEFAULT_BILLING_CONFIG)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => invalidateBillingConfig(), [])
  useEffect(() => subscribeBillingConfig(() => setRevision((value) => value + 1)), [])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getBillingConfig()
      .then((data) => {
        if (active) setConfig(data)
      })
      .catch((error) => {
        if (active) setError(error.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [user?.uid, revision])
  return { config, loading, error, refresh }
}

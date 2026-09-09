import { useEffect, useState } from 'react'
import { getBillingConfig } from '../services/billingService'
import { DEFAULT_BILLING_CONFIG } from '../utils/billing'

export function useBillingConfig() {
  const [config, setConfig] = useState(DEFAULT_BILLING_CONFIG)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getBillingConfig()
      .then((data) => {
        if (active) setConfig(data)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return { config, loading }
}

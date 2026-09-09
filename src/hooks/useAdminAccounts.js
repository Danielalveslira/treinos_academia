import { useCallback, useEffect, useState } from 'react'
import {
  listAllAccounts,
  setAccountStatus,
  confirmPayment,
  deleteAccountPermanently,
} from '../services/billingService'
import { describeFirestoreError } from '../utils/firestoreError'

export function useAdminAccounts() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAccounts(await listAllAccounts())
    } catch (err) {
      setError(describeFirestoreError(err, 'useAdminAccounts'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function disable(userId, reason) {
    await setAccountStatus(userId, true, reason)
    await refresh()
  }

  async function enable(userId) {
    await setAccountStatus(userId, false)
    await refresh()
  }

  async function confirm(userId, planId) {
    await confirmPayment(userId, planId)
    await refresh()
  }

  async function remove(userId) {
    await deleteAccountPermanently(userId, 'EXCLUIR')
    setAccounts((prev) => prev.filter((account) => account.id !== userId))
  }

  return { accounts, loading, error, refresh, disable, enable, confirm, remove }
}

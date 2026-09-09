import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listAccountsPage,
  setAccountStatus,
  confirmPayment,
  deleteAccountPermanently,
  listDeletionJobs,
} from '../services/billingService'
import { describeFirestoreError } from '../utils/firestoreError'

export function useAdminAccounts(search = '') {
  const [accounts, setAccounts] = useState([])
  const [jobs, setJobs] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const revision = useRef(0)
  const invalidate = useCallback(() => {
    revision.current++
  }, [])
  const actionLock = useRef(false)
  const refresh = useCallback(async () => {
    const current = ++revision.current
    setLoading(true)
    setError(null)
    try {
      const [page, pending] = await Promise.all([listAccountsPage({ search }), listDeletionJobs()])
      if (current !== revision.current) return
      setAccounts(page.accounts)
      setCursor(page.nextCursor)
      setJobs(pending)
    } catch (err) {
      if (current === revision.current) setError(describeFirestoreError(err, 'useAdminAccounts'))
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }, [search])
  useEffect(() => {
    setLoading(true)
    setAccounts([])
    setCursor(null)
    const timer = setTimeout(refresh, search ? 350 : 0)
    return () => {
      clearTimeout(timer)
      invalidate()
    }
  }, [refresh, search, invalidate])
  async function loadMore() {
    if (loading || !cursor) return
    const current = revision.current
    setLoading(true)
    try {
      const page = await listAccountsPage({ search, cursor })
      if (current !== revision.current) return
      setAccounts((previous) => [
        ...new Map(
          [...previous, ...page.accounts].map((account) => [account.id, account])
        ).values(),
      ])
      setCursor(page.nextCursor)
    } catch (err) {
      if (current === revision.current) setError(describeFirestoreError(err, 'listAccountsPage'))
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }
  async function change(userId, action) {
    if (actionLock.current) throw new Error('Aguarde a operação atual.')
    actionLock.current = true
    setBusy(userId)
    try {
      const result = await action()
      setAccounts((previous) =>
        previous.map((account) =>
          account.id === userId
            ? {
                ...account,
                ...(result.account || { accountStatus: 'deleting' }),
                email: account.email,
              }
            : account
        )
      )
      return result
    } finally {
      actionLock.current = false
      setBusy(null)
    }
  }
  const disable = (uid, reason) => change(uid, () => setAccountStatus(uid, true, reason))
  const enable = (uid) => change(uid, () => setAccountStatus(uid, false))
  const confirm = (uid, planId) => change(uid, () => confirmPayment(uid, planId))
  const remove = (uid) => change(uid, () => deleteAccountPermanently(uid, 'EXCLUIR'))
  return {
    accounts,
    jobs,
    loading,
    error,
    busy,
    hasMore: !!cursor,
    loadMore,
    refresh,
    disable,
    enable,
    confirm,
    remove,
  }
}

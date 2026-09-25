import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listBlockedAccountDeletions,
  reviewBlockedAccountDeletion,
} from '../services/adminAccountDeletionsService'
import { resolveUsernamesByIds } from '../services/cashPurchaseService'
import { describeFirestoreError } from '../utils/firestoreError'

// Mesmo padrão de useAdminAccounts/useAdminCashPurchases: revision descarta respostas
// atrasadas de uma consulta anterior, actionLock impede duas revisões simultâneas na
// mesma sessão do painel.
export function useAdminAccountDeletions() {
  const [jobs, setJobs] = useState([])
  const [usernameById, setUsernameById] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const revision = useRef(0)
  const actionLock = useRef(false)
  const invalidate = useCallback(() => {
    revision.current++
  }, [])

  const refresh = useCallback(async () => {
    const current = ++revision.current
    setLoading(true)
    setError(null)
    try {
      const list = await listBlockedAccountDeletions()
      if (current !== revision.current) return
      setJobs(list)
      const names = await resolveUsernamesByIds(list.map((job) => job.targetId))
      if (current === revision.current) setUsernameById(names)
    } catch (err) {
      if (current === revision.current) setError(describeFirestoreError(err, 'useAdminAccountDeletions'))
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    return invalidate
  }, [refresh, invalidate])

  async function review(jobId, note) {
    if (actionLock.current) throw new Error('Aguarde a operação atual.')
    actionLock.current = true
    setBusy(jobId)
    try {
      const result = await reviewBlockedAccountDeletion(jobId, note)
      // resumed:true -- o job saiu de blocked_financial_review, não faz mais sentido
      // segurar na lista até o próximo refresh manual.
      if (result.resumed) setJobs((previous) => previous.filter((job) => job.id !== jobId))
      return result
    } finally {
      actionLock.current = false
      setBusy(null)
    }
  }

  return { jobs, usernameById, loading, error, busy, refresh, review }
}

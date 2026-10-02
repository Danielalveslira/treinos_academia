import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelAccountDeletion,
  listAccountDeletions,
  reviewBlockedAccountDeletion,
  separateFinancialCaseAndResumeDeletion,
} from '../services/adminAccountDeletionsService'
import { describeQueryError } from '../utils/queryError'

// Mesmo padrão de useAdminAccounts/useAdminCashPurchases: revision descarta respostas
// atrasadas de uma consulta anterior, actionLock impede duas ações simultâneas na mesma
// sessão do painel. Depois de cada ação a lista é relida do servidor -- nenhuma decisão
// (nem o novo estado do job) é inferida no cliente.
export function useAdminAccountDeletions() {
  const [scope, setScope] = useState('open')
  const [requests, setRequests] = useState([])
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
      const list = await listAccountDeletions(scope)
      if (current !== revision.current) return
      setRequests(list)
    } catch (err) {
      if (current === revision.current)
        setError(describeQueryError(err, 'useAdminAccountDeletions'))
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    refresh()
    return invalidate
  }, [refresh, invalidate])

  async function runAction(jobId, action) {
    if (actionLock.current) throw new Error('Aguarde a operação atual.')
    actionLock.current = true
    setBusy(jobId)
    try {
      const result = await action()
      await refresh()
      return result
    } finally {
      actionLock.current = false
      setBusy(null)
    }
  }

  return {
    scope,
    setScope,
    requests,
    loading,
    error,
    busy,
    refresh,
    review: (jobId, note) => runAction(jobId, () => reviewBlockedAccountDeletion(jobId, note)),
    separateCase: (jobId, note) =>
      runAction(jobId, () => separateFinancialCaseAndResumeDeletion(jobId, note)),
    cancel: (jobId, note) => runAction(jobId, () => cancelAccountDeletion(jobId, note)),
  }
}

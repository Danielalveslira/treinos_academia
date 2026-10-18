import { useCallback, useEffect, useState } from 'react'
import { getLatestCashPurchaseReminders } from '../services/cashPurchaseService'

// Mostra "Último lembrete enviado em..." sem N+1: uma única consulta para toda a página
// (ver getLatestCashPurchaseReminders), diferente de useUsernamesByIds -- aqui o status pode
// mudar (pending -> sent) enquanto a tela está aberta, então refresh() reconsulta de
// propósito depois de enfileirar um novo lembrete, em vez de um cache permanente.
export function useLatestCashPurchaseReminders(purchaseIds) {
  const key = purchaseIds.join(',')
  const [byPurchaseId, setByPurchaseId] = useState({})

  const load = useCallback(async () => {
    const uniqueIds = [...new Set(purchaseIds)].filter(Boolean)
    if (uniqueIds.length === 0) {
      setByPurchaseId({})
      return
    }
    const result = await getLatestCashPurchaseReminders(uniqueIds)
    setByPurchaseId(result)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` já resume o array
  }, [key])

  useEffect(() => {
    load()
  }, [load])

  return { latestReminderByPurchaseId: byPurchaseId, refreshLatestReminders: load }
}

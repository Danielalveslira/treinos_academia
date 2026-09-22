import { useSearchParams } from 'react-router-dom'
import { normalizeCashPurchasesAdminTab } from '../utils/cashPurchaseFlow'

export function useAdminCashPurchasesTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = normalizeCashPurchasesAdminTab(searchParams.get('tab'))

  function selectTab(nextTab) {
    const normalizedTab = normalizeCashPurchasesAdminTab(nextTab)
    setSearchParams(normalizedTab === 'pedidos' ? {} : { tab: normalizedTab }, { replace: true })
  }

  return { tab, selectTab }
}

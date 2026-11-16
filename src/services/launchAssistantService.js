// PR4b: agrega leituras já existentes (nenhuma RPC nova) para o assistente de
// lançamento. Cada fonte falha de forma independente -- uma consulta com erro nunca
// esconde nem invalida as outras três (mesmo padrão já usado em CommercialOverview/
// ApprovalsQueue: Promise.all de promessas que já se capturam, não Promise.all que
// rejeita no primeiro erro).
import { getSupplierInfoConfigured } from './supplierInfoGateService'
import { getEvoCashPricing } from './evocashPricingService'
import { getCommercialCatalog, setCommercialSales } from './commercialService'
import { getAdvertisingInventory, configureAdvertisingPlacement } from './advertisingService'

async function fromSource(fn) {
  try {
    return { state: 'ready', value: await fn() }
  } catch {
    return { state: 'error', value: null }
  }
}

export async function getLaunchVerification() {
  const [supplier, evocash, catalog, inventory] = await Promise.all([
    fromSource(getSupplierInfoConfigured),
    fromSource(getEvoCashPricing),
    fromSource(getCommercialCatalog),
    fromSource(getAdvertisingInventory),
  ])
  return { supplier, evocash, catalog, inventory }
}

// As duas únicas escritas que o assistente executa: ligar vendas de um serviço já
// configurado, ou ligar vendas+exibição de um espaço já com capacidade -- nunca criar
// preço, capacidade ou espaço novo (isso continua nas telas administrativas existentes,
// via o link de "Configurar" de cada requisito pendente).
export const activateOffering = ({ code, revision, requestId, reason }) =>
  setCommercialSales({ code, enabled: true, revision, requestId, reason, confirm: true })

export const activatePlacement = ({ code, capacity, revision, reason }) =>
  configureAdvertisingPlacement(
    { code, revision },
    { capacity, salesEnabled: true, deliveryEnabled: true, reason }
  )

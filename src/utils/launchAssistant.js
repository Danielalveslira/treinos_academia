// Regras puras do assistente de lançamento comercial (PR4b): a partir dos dados já
// retornados por RPCs existentes (fornecedor, EvoCash, catálogo comercial, inventário de
// publicidade), decide o estado de cada requisito e se ele é elegível para ativação
// direta. Nenhuma chamada de rede aqui -- isolado para ser testável sem montar nada.
export const STATUS = {
  DONE: 'done',
  PENDING: 'pending',
  PAUSED: 'paused',
  BLOCKED: 'blocked',
  UNAVAILABLE: 'unavailable',
}

const FINANCEIRO_MOTOR = '/admin/parcerias?area=financeiro&tab=motor'
const FINANCEIRO_FORNECEDOR = '/admin/parcerias?area=financeiro&tab=avancado'
const EVOCASH_PRECOS = '/admin/compras-evocash?tab=pricing'
const PUBLICIDADE_CANAIS = '/admin/parcerias?area=publicidade&tab=canais'

function supplierRow(source) {
  const ready = source.state === 'ready'
  const configured = ready && source.value === true
  return {
    id: 'supplier',
    category: 'Fornecedor',
    label: 'Identificação do fornecedor',
    status: !ready ? STATUS.UNAVAILABLE : configured ? STATUS.DONE : STATUS.PENDING,
    detail: !ready
      ? 'Não foi possível verificar.'
      : configured
        ? 'Fornecedor configurado.'
        : 'Identificação do fornecedor ainda não confirmada.',
    action:
      !ready || configured ? null : { label: 'Verificar fornecedor', to: FINANCEIRO_FORNECEDOR },
    activation: null,
  }
}

function evocashRows(source) {
  const ready = source.state === 'ready'
  const value = ready ? source.value : null
  const row = (id, label, enabled) => ({
    id,
    category: 'EvoCash',
    label,
    status: !ready ? STATUS.UNAVAILABLE : enabled ? STATUS.DONE : STATUS.PAUSED,
    detail: !ready
      ? 'Não foi possível verificar.'
      : enabled
        ? `${label} habilitada.`
        : `${label} pausada intencionalmente.`,
    action:
      !ready || enabled ? null : { label: 'Consultar configuração financeira', to: EVOCASH_PRECOS },
    activation: null,
  })
  return [
    row('evocash-quoting', 'Cotação de EvoCash', value?.quotingEnabled),
    row('evocash-checkout', 'Checkout de EvoCash', value?.checkoutEnabled),
  ]
}

function offeringRows(source) {
  if (source.state !== 'ready') {
    return [
      {
        id: 'commercial-catalog',
        category: 'Serviços comerciais',
        label: 'Serviços comerciais',
        status: STATUS.UNAVAILABLE,
        detail: 'Não foi possível verificar.',
        action: null,
        activation: null,
      },
    ]
  }
  return (source.value.items || []).map((item) => {
    const status = !item.integrationReady
      ? STATUS.BLOCKED
      : !item.currentPrice
        ? STATUS.PENDING
        : item.salesEnabled
          ? STATUS.DONE
          : STATUS.PAUSED
    return {
      id: `offering-${item.code}`,
      category: 'Serviços comerciais',
      label: item.name,
      status,
      detail:
        status === STATUS.BLOCKED
          ? 'Integração ainda não disponível.'
          : status === STATUS.PENDING
            ? 'Preço ainda não configurado.'
            : status === STATUS.PAUSED
              ? 'Vendas pausadas intencionalmente.'
              : 'Pronto, com vendas habilitadas.',
      action:
        status === STATUS.PENDING || status === STATUS.BLOCKED
          ? { label: 'Configurar preço', to: FINANCEIRO_MOTOR }
          : null,
      activation:
        status === STATUS.PAUSED
          ? { kind: 'offering', code: item.code, revision: Number(item.revision) }
          : null,
    }
  })
}

function placementRows(source) {
  if (source.state !== 'ready') {
    return [
      {
        id: 'advertising-inventory',
        category: 'Espaços publicitários',
        label: 'Espaços publicitários',
        status: STATUS.UNAVAILABLE,
        detail: 'Não foi possível verificar.',
        action: null,
        activation: null,
      },
    ]
  }
  return (source.value.placements || []).map((placement) => {
    const status =
      placement.capacity <= 0
        ? STATUS.PENDING
        : placement.sales_enabled && placement.delivery_enabled
          ? STATUS.DONE
          : STATUS.PAUSED
    return {
      id: `placement-${placement.code}`,
      category: 'Espaços publicitários',
      label: placement.name,
      status,
      detail:
        status === STATUS.PENDING
          ? 'Capacidade ainda não configurada.'
          : status === STATUS.PAUSED
            ? 'Novas vendas ou exibição pausadas intencionalmente.'
            : 'Pronto, com vendas e exibição habilitadas.',
      action:
        status === STATUS.PENDING ? { label: 'Configurar espaço', to: PUBLICIDADE_CANAIS } : null,
      activation:
        status === STATUS.PAUSED
          ? {
              kind: 'placement',
              code: placement.code,
              capacity: placement.capacity,
              revision: Number(placement.revision),
            }
          : null,
    }
  })
}

// `data` é o retorno de getLaunchVerification(): { supplier, evocash, catalog, inventory },
// cada um { state: 'ready'|'error', value }. Uma falha de consulta nunca aparece como
// requisito concluído -- vira STATUS.UNAVAILABLE, sempre sem ação de ativação disponível.
export function buildRequirements(data) {
  return [
    supplierRow(data.supplier),
    ...evocashRows(data.evocash),
    ...offeringRows(data.catalog),
    ...placementRows(data.inventory),
  ]
}

export function pendingCount(requirements) {
  return requirements.filter(
    (row) => row.status === STATUS.PENDING || row.status === STATUS.BLOCKED
  ).length
}

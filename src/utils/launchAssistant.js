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

function unavailableRow(id, category, label) {
  return {
    id,
    category,
    label,
    status: STATUS.UNAVAILABLE,
    detail: 'Não foi possível verificar.',
    action: null,
    activation: [],
  }
}

function supplierRow(source) {
  // Uma resposta que não seja exatamente true/false (campo ausente, tipo errado, RPC
  // devolvendo algo inesperado) nunca é tratada como "ainda não configurado" -- isso
  // esconderia um problema de consulta atrás de uma pendência comum.
  const valid = source.state === 'ready' && typeof source.value === 'boolean'
  const configured = valid && source.value === true
  if (!valid) return unavailableRow('supplier', 'Fornecedor', 'Identificação do fornecedor')
  return {
    id: 'supplier',
    category: 'Fornecedor',
    label: 'Identificação do fornecedor',
    status: configured ? STATUS.DONE : STATUS.PENDING,
    detail: configured
      ? 'Fornecedor configurado.'
      : 'Identificação do fornecedor ainda não confirmada.',
    action: configured ? null : { label: 'Verificar fornecedor', to: FINANCEIRO_FORNECEDOR },
    activation: [],
  }
}

function evocashRows(source) {
  const ready = source.state === 'ready'
  const value = ready ? source.value : null
  function row(id, label, field) {
    // quotingEnabled/checkoutEnabled precisam ser booleanos de verdade -- undefined, null,
    // string ou número nunca podem significar "pausado": isso é uma resposta inválida, não
    // uma decisão de negócio.
    const valid = ready && value && typeof value[field] === 'boolean'
    if (!valid) return unavailableRow(id, 'EvoCash', label)
    const enabled = value[field]
    return {
      id,
      category: 'EvoCash',
      label,
      status: enabled ? STATUS.DONE : STATUS.PAUSED,
      detail: enabled ? `${label} habilitada.` : `${label} pausada intencionalmente.`,
      action: enabled ? null : { label: 'Consultar configuração financeira', to: EVOCASH_PRECOS },
      activation: [],
    }
  }
  return [
    row('evocash-quoting', 'Cotação de EvoCash', 'quotingEnabled'),
    row('evocash-checkout', 'Checkout de EvoCash', 'checkoutEnabled'),
  ]
}

function isValidOfferingItem(item) {
  return (
    !!item &&
    typeof item.code === 'string' &&
    item.code.length > 0 &&
    typeof item.name === 'string' &&
    item.name.length > 0 &&
    typeof item.integrationReady === 'boolean' &&
    typeof item.salesEnabled === 'boolean' &&
    Number.isFinite(Number(item.revision)) &&
    (item.currentPrice === null ||
      (!!item.currentPrice &&
        item.currentPrice.unitPriceCash != null &&
        item.currentPrice.minDays != null &&
        item.currentPrice.maxDays != null))
  )
}

function offeringRows(source) {
  if (source.state !== 'ready') {
    return [unavailableRow('commercial-catalog', 'Serviços comerciais', 'Serviços comerciais')]
  }
  const items = Array.isArray(source.value?.items) ? source.value.items : null
  if (items === null) {
    return [unavailableRow('commercial-catalog', 'Serviços comerciais', 'Serviços comerciais')]
  }
  return items.map((item, index) => {
    if (!isValidOfferingItem(item)) {
      const label =
        typeof item?.name === 'string' && item.name ? item.name : `Serviço comercial ${index + 1}`
      return unavailableRow(`offering-${item?.code || index}`, 'Serviços comerciais', label)
    }
    const status = !item.integrationReady
      ? STATUS.BLOCKED
      : !item.currentPrice
        ? STATUS.PENDING
        : item.salesEnabled
          ? STATUS.DONE
          : STATUS.PAUSED
    const revision = Number(item.revision)
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
          ? [
              {
                id: `offering-${item.code}-sales`,
                kind: 'offering',
                code: item.code,
                revision,
                label: 'Ativar',
                confirmTitle: `Ativar "${item.name}"`,
                confirmText: `Vendas serão habilitadas para "${item.name}".`,
              },
            ]
          : [],
    }
  })
}

function isValidPlacement(placement) {
  return (
    !!placement &&
    typeof placement.code === 'string' &&
    placement.code.length > 0 &&
    typeof placement.name === 'string' &&
    placement.name.length > 0 &&
    Number.isFinite(placement.capacity) &&
    placement.capacity >= 0 &&
    typeof placement.sales_enabled === 'boolean' &&
    typeof placement.delivery_enabled === 'boolean' &&
    Number.isFinite(Number(placement.revision))
  )
}

function placementRows(source) {
  if (source.state !== 'ready') {
    return [
      unavailableRow('advertising-inventory', 'Espaços publicitários', 'Espaços publicitários'),
    ]
  }
  const placements = Array.isArray(source.value?.placements) ? source.value.placements : null
  if (placements === null) {
    return [
      unavailableRow('advertising-inventory', 'Espaços publicitários', 'Espaços publicitários'),
    ]
  }
  return placements.map((placement, index) => {
    if (!isValidPlacement(placement)) {
      const label =
        typeof placement?.name === 'string' && placement.name
          ? placement.name
          : `Espaço publicitário ${index + 1}`
      return unavailableRow(`placement-${placement?.code || index}`, 'Espaços publicitários', label)
    }
    const status =
      placement.capacity <= 0
        ? STATUS.PENDING
        : placement.sales_enabled && placement.delivery_enabled
          ? STATUS.DONE
          : STATUS.PAUSED
    const revision = Number(placement.revision)
    // Contratações e exibição são controles distintos: cada um só é oferecido como ação
    // de ativação separada quando está, de fato, pausado -- nunca os dois juntos por
    // padrão, e o controle já habilitado nunca é tocado (o valor atual é preservado em
    // cada ação, não assumido).
    const activation =
      status === STATUS.PAUSED
        ? [
            !placement.sales_enabled && {
              id: `placement-${placement.code}-sales`,
              kind: 'placement',
              code: placement.code,
              capacity: placement.capacity,
              revision,
              salesEnabled: true,
              deliveryEnabled: placement.delivery_enabled,
              label: 'Ativar novas contratações',
              confirmTitle: `Ativar novas contratações em "${placement.name}"`,
              confirmText: `Novas contratações serão habilitadas para "${placement.name}". A exibição de campanhas já contratadas não muda.`,
            },
            !placement.delivery_enabled && {
              id: `placement-${placement.code}-delivery`,
              kind: 'placement',
              code: placement.code,
              capacity: placement.capacity,
              revision,
              salesEnabled: placement.sales_enabled,
              deliveryEnabled: true,
              label: 'Ativar exibição',
              confirmTitle: `Ativar exibição em "${placement.name}"`,
              confirmText: `A exibição de campanhas será habilitada para "${placement.name}". Novas contratações não mudam.`,
            },
          ].filter(Boolean)
        : []
    return {
      id: `placement-${placement.code}`,
      category: 'Espaços publicitários',
      label: placement.name,
      status,
      detail:
        status === STATUS.PENDING
          ? 'Capacidade ainda não configurada.'
          : status === STATUS.PAUSED
            ? !placement.sales_enabled && !placement.delivery_enabled
              ? 'Novas contratações e exibição pausadas intencionalmente.'
              : !placement.sales_enabled
                ? 'Novas contratações pausadas intencionalmente.'
                : 'Exibição pausada intencionalmente.'
            : 'Pronto, com contratações e exibição habilitadas.',
      action:
        status === STATUS.PENDING ? { label: 'Configurar espaço', to: PUBLICIDADE_CANAIS } : null,
      activation,
    }
  })
}

// `data` é o retorno de getLaunchVerification(): { supplier, evocash, catalog, inventory },
// cada um { state: 'ready'|'error', value }. Uma falha de consulta, ou uma resposta com
// campo ausente/de tipo errado, nunca aparece como requisito concluído nem pausado --
// vira STATUS.UNAVAILABLE, sempre sem ação de ativação disponível.
export function buildRequirements(data) {
  return [
    ...[supplierRow(data.supplier)],
    ...evocashRows(data.evocash),
    ...offeringRows(data.catalog),
    ...placementRows(data.inventory),
  ]
}

// Resumo operacional do assistente: nunca declara "tudo pronto" quando algo está
// pausado, bloqueado ou indisponível -- mesmo que nenhuma configuração esteja
// pendente. Reembolsos e aprovações editoriais não entram nesta contagem; este
// resumo é só sobre os requisitos de lançamento comercial.
export function operationalSummary(requirements) {
  let pending = 0
  let paused = 0
  let unavailable = 0
  for (const row of requirements) {
    if (row.status === STATUS.PENDING || row.status === STATUS.BLOCKED) pending++
    else if (row.status === STATUS.PAUSED) paused++
    else if (row.status === STATUS.UNAVAILABLE) unavailable++
  }
  if (unavailable > 0) {
    return { tone: 'unavailable', text: 'Não foi possível verificar todos os requisitos' }
  }
  if (pending === 0 && paused === 0) {
    return { tone: 'done', text: 'Tudo pronto — publicidade ativa' }
  }
  const parts = []
  if (pending > 0)
    parts.push(
      `${pending} configuraç${pending === 1 ? 'ão' : 'ões'} pendente${pending === 1 ? '' : 's'}`
    )
  if (paused > 0)
    parts.push(`${paused} serviç${paused === 1 ? 'o' : 'os'} pausado${paused === 1 ? '' : 's'}`)
  if (pending === 0) parts.unshift('Sem pendências de configuração')
  return { tone: pending > 0 ? 'pending' : 'paused', text: parts.join(' · ') }
}

// Mantido para compatibilidade com quem só precisa do total de pendências/bloqueios
// (ex.: um indicador simples) -- operationalSummary() é a função correta para o resumo
// textual completo, que também considera pausado/indisponível.
export function pendingCount(requirements) {
  return requirements.filter(
    (row) => row.status === STATUS.PENDING || row.status === STATUS.BLOCKED
  ).length
}

// Usado pela revalidação imediatamente antes de qualquer ativação: localiza, na lista
// de requisitos recém-recalculada, a MESMA ação específica (não só a mesma linha --
// uma linha de espaço publicitário pode ter até duas ações independentes) que o
// administrador clicou. Se não existir mais (serviço removido, estado mudou, deixou de
// ser elegível), retorna null -- nunca os dados antigos.
export function findCurrentActivation(requirements, activationId) {
  for (const row of requirements) {
    const match = row.activation.find((a) => a.id === activationId)
    if (match) return match
  }
  return null
}

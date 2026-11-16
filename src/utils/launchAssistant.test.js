import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRequirements,
  operationalSummary,
  findCurrentActivation,
  pendingCount,
  STATUS,
} from './launchAssistant.js'

const ready = (value) => ({ state: 'ready', value })
const errored = () => ({ state: 'error', value: null })

const ALL_READY_EMPTY = {
  supplier: ready(true),
  evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
  catalog: ready({ items: [] }),
  inventory: ready({ placements: [] }),
}

function rowsFor(data, id) {
  return buildRequirements(data).filter((row) => row.id === id)
}

function offeringItem(overrides = {}) {
  return {
    code: 'post_boost',
    name: 'Impulsionar publicação',
    integrationReady: true,
    salesEnabled: false,
    revision: '5',
    currentPrice: { unitPriceCash: '7', minDays: 1, maxDays: 5 },
    ...overrides,
  }
}

function placementItem(overrides = {}) {
  return {
    code: 'home_banner',
    name: 'Banner da Home',
    capacity: 10,
    sales_enabled: false,
    delivery_enabled: false,
    revision: 2,
    ...overrides,
  }
}

// --- fornecedor ---------------------------------------------------------

test('fornecedor configurado é concluído, sem ação nem ativação', () => {
  const [row] = rowsFor(ALL_READY_EMPTY, 'supplier')
  assert.equal(row.status, STATUS.DONE)
  assert.equal(row.action, null)
  assert.deepEqual(row.activation, [])
})

test('fornecedor pendente tem ação de configuração', () => {
  const data = { ...ALL_READY_EMPTY, supplier: ready(false) }
  const [row] = rowsFor(data, 'supplier')
  assert.equal(row.status, STATUS.PENDING)
  assert.ok(row.action?.to)
})

test('falha ao consultar fornecedor nunca aparece como concluído', () => {
  const data = { ...ALL_READY_EMPTY, supplier: errored() }
  const [row] = rowsFor(data, 'supplier')
  assert.equal(row.status, STATUS.UNAVAILABLE)
  assert.deepEqual(row.activation, [])
})

test('resposta inválida do fornecedor (tipo errado) é indisponível, nunca "pendente"', () => {
  const data = { ...ALL_READY_EMPTY, supplier: ready('nao-é-booleano') }
  const [row] = rowsFor(data, 'supplier')
  assert.equal(row.status, STATUS.UNAVAILABLE)
})

test('resposta inválida do fornecedor (null) é indisponível', () => {
  const data = { ...ALL_READY_EMPTY, supplier: ready(null) }
  const [row] = rowsFor(data, 'supplier')
  assert.equal(row.status, STATUS.UNAVAILABLE)
})

// --- EvoCash --------------------------------------------------------------

test('cotação e checkout de EvoCash são requisitos independentes, sem ativação direta', () => {
  const data = {
    ...ALL_READY_EMPTY,
    evocash: ready({ quotingEnabled: true, checkoutEnabled: false }),
  }
  const quoting = rowsFor(data, 'evocash-quoting')[0]
  const checkout = rowsFor(data, 'evocash-checkout')[0]
  assert.equal(quoting.status, STATUS.DONE)
  assert.equal(checkout.status, STATUS.PAUSED)
  assert.ok(checkout.action?.to)
  assert.deepEqual(checkout.activation, [], 'EvoCash nunca tem ativação direta pelo assistente')
})

test('falha ao consultar EvoCash torna os dois requisitos indisponíveis', () => {
  const data = { ...ALL_READY_EMPTY, evocash: errored() }
  assert.equal(rowsFor(data, 'evocash-quoting')[0].status, STATUS.UNAVAILABLE)
  assert.equal(rowsFor(data, 'evocash-checkout')[0].status, STATUS.UNAVAILABLE)
})

test('campo ausente em quotingEnabled/checkoutEnabled é indisponível, nunca "pausado"', () => {
  const data = { ...ALL_READY_EMPTY, evocash: ready({}) }
  assert.equal(rowsFor(data, 'evocash-quoting')[0].status, STATUS.UNAVAILABLE)
  assert.equal(rowsFor(data, 'evocash-checkout')[0].status, STATUS.UNAVAILABLE)
})

test('tipo inválido (string/número) em quotingEnabled/checkoutEnabled é indisponível', () => {
  const data = {
    ...ALL_READY_EMPTY,
    evocash: ready({ quotingEnabled: 'true', checkoutEnabled: 1 }),
  }
  assert.equal(rowsFor(data, 'evocash-quoting')[0].status, STATUS.UNAVAILABLE)
  assert.equal(rowsFor(data, 'evocash-checkout')[0].status, STATUS.UNAVAILABLE)
})

test('null em evocash.value (resposta presente mas vazia) é indisponível', () => {
  const data = { ...ALL_READY_EMPTY, evocash: ready(null) }
  assert.equal(rowsFor(data, 'evocash-quoting')[0].status, STATUS.UNAVAILABLE)
})

// --- catálogo comercial ----------------------------------------------------

test('serviço sem integração disponível é bloqueado, com ação de configuração', () => {
  const data = {
    ...ALL_READY_EMPTY,
    catalog: ready({ items: [offeringItem({ integrationReady: false, currentPrice: null })] }),
  }
  const [row] = rowsFor(data, 'offering-post_boost')
  assert.equal(row.status, STATUS.BLOCKED)
  assert.ok(row.action?.to)
  assert.deepEqual(row.activation, [])
})

test('serviço integrado sem preço é pendente, nunca elegível para ativação', () => {
  const data = {
    ...ALL_READY_EMPTY,
    catalog: ready({ items: [offeringItem({ currentPrice: null })] }),
  }
  const [row] = rowsFor(data, 'offering-post_boost')
  assert.equal(row.status, STATUS.PENDING)
  assert.deepEqual(row.activation, [])
})

test('serviço pronto mas com vendas pausadas é elegível para uma ativação', () => {
  const data = { ...ALL_READY_EMPTY, catalog: ready({ items: [offeringItem()] }) }
  const [row] = rowsFor(data, 'offering-post_boost')
  assert.equal(row.status, STATUS.PAUSED)
  assert.equal(row.action, null)
  assert.equal(row.activation.length, 1)
  assert.equal(row.activation[0].kind, 'offering')
  assert.equal(row.activation[0].code, 'post_boost')
  assert.equal(row.activation[0].revision, 5)
  assert.equal(row.activation[0].id, 'offering-post_boost-sales')
})

test('serviço com vendas habilitadas é concluído, sem ativação pendente', () => {
  const data = {
    ...ALL_READY_EMPTY,
    catalog: ready({ items: [offeringItem({ salesEnabled: true })] }),
  }
  const [row] = rowsFor(data, 'offering-post_boost')
  assert.equal(row.status, STATUS.DONE)
  assert.deepEqual(row.activation, [])
})

test('falha ao consultar o catálogo gera uma única linha indisponível', () => {
  const data = { ...ALL_READY_EMPTY, catalog: errored() }
  const rows = buildRequirements(data).filter((row) => row.category === 'Serviços comerciais')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, STATUS.UNAVAILABLE)
})

test('catálogo com "items" ausente/não-array é indisponível, não uma lista vazia', () => {
  const data = { ...ALL_READY_EMPTY, catalog: ready({}) }
  const rows = buildRequirements(data).filter((row) => row.category === 'Serviços comerciais')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, STATUS.UNAVAILABLE)
})

test('item do catálogo com campo essencial ausente é indisponível, não pausado por engano', () => {
  const data = {
    ...ALL_READY_EMPTY,
    catalog: ready({ items: [offeringItem({ salesEnabled: undefined })] }),
  }
  const [row] = rowsFor(data, 'offering-post_boost')
  assert.equal(row.status, STATUS.UNAVAILABLE)
  assert.deepEqual(row.activation, [])
})

test('item do catálogo com revisão não numérica é indisponível', () => {
  const data = {
    ...ALL_READY_EMPTY,
    catalog: ready({ items: [offeringItem({ revision: 'não é número' })] }),
  }
  const [row] = rowsFor(data, 'offering-post_boost')
  assert.equal(row.status, STATUS.UNAVAILABLE)
})

test('item do catálogo com currentPrice incompleto é indisponível', () => {
  const data = {
    ...ALL_READY_EMPTY,
    catalog: ready({ items: [offeringItem({ currentPrice: { unitPriceCash: '7' } })] }),
  }
  const [row] = rowsFor(data, 'offering-post_boost')
  assert.equal(row.status, STATUS.UNAVAILABLE)
})

// --- inventário de publicidade ---------------------------------------------

test('espaço sem capacidade é pendente, nunca elegível para ativação', () => {
  const data = {
    ...ALL_READY_EMPTY,
    inventory: ready({ placements: [placementItem({ capacity: 0 })] }),
  }
  const [row] = rowsFor(data, 'placement-home_banner')
  assert.equal(row.status, STATUS.PENDING)
  assert.deepEqual(row.activation, [])
})

test('espaço com os dois controles pausados oferece as duas ações separadamente', () => {
  const data = { ...ALL_READY_EMPTY, inventory: ready({ placements: [placementItem()] }) }
  const [row] = rowsFor(data, 'placement-home_banner')
  assert.equal(row.status, STATUS.PAUSED)
  assert.equal(row.activation.length, 2)
  const sales = row.activation.find((a) => a.id === 'placement-home_banner-sales')
  const delivery = row.activation.find((a) => a.id === 'placement-home_banner-delivery')
  assert.equal(sales.salesEnabled, true)
  assert.equal(sales.deliveryEnabled, false, 'ativar contratações não liga a exibição sozinha')
  assert.equal(delivery.deliveryEnabled, true)
  assert.equal(delivery.salesEnabled, false, 'ativar exibição não liga as contratações sozinha')
})

test('espaço só com contratações pausadas oferece só essa ação, preservando a exibição já ligada', () => {
  const data = {
    ...ALL_READY_EMPTY,
    inventory: ready({
      placements: [placementItem({ sales_enabled: false, delivery_enabled: true })],
    }),
  }
  const [row] = rowsFor(data, 'placement-home_banner')
  assert.equal(row.activation.length, 1)
  assert.equal(row.activation[0].id, 'placement-home_banner-sales')
  assert.equal(row.activation[0].deliveryEnabled, true, 'preserva o valor atual, não força false')
})

test('espaço só com exibição pausada oferece só essa ação, preservando as contratações já ligadas', () => {
  const data = {
    ...ALL_READY_EMPTY,
    inventory: ready({
      placements: [placementItem({ sales_enabled: true, delivery_enabled: false })],
    }),
  }
  const [row] = rowsFor(data, 'placement-home_banner')
  assert.equal(row.activation.length, 1)
  assert.equal(row.activation[0].id, 'placement-home_banner-delivery')
  assert.equal(row.activation[0].salesEnabled, true, 'preserva o valor atual, não força false')
})

test('capacidade nunca é alterada por nenhuma ação de ativação de espaço', () => {
  const data = {
    ...ALL_READY_EMPTY,
    inventory: ready({ placements: [placementItem({ capacity: 37 })] }),
  }
  const [row] = rowsFor(data, 'placement-home_banner')
  for (const activation of row.activation) assert.equal(activation.capacity, 37)
})

test('espaço com contratações e exibição habilitadas é concluído', () => {
  const data = {
    ...ALL_READY_EMPTY,
    inventory: ready({
      placements: [placementItem({ sales_enabled: true, delivery_enabled: true })],
    }),
  }
  const [row] = rowsFor(data, 'placement-home_banner')
  assert.equal(row.status, STATUS.DONE)
  assert.deepEqual(row.activation, [])
})

test('falha ao consultar o inventário de publicidade gera uma única linha indisponível', () => {
  const data = { ...ALL_READY_EMPTY, inventory: errored() }
  const rows = buildRequirements(data).filter((row) => row.category === 'Espaços publicitários')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, STATUS.UNAVAILABLE)
})

test('espaço com campo essencial ausente (ex.: sales_enabled) é indisponível, não pausado', () => {
  const data = {
    ...ALL_READY_EMPTY,
    inventory: ready({ placements: [placementItem({ sales_enabled: undefined })] }),
  }
  const [row] = rowsFor(data, 'placement-home_banner')
  assert.equal(row.status, STATUS.UNAVAILABLE)
  assert.deepEqual(row.activation, [])
})

test('espaço com capacidade de tipo inválido (string) é indisponível', () => {
  const data = {
    ...ALL_READY_EMPTY,
    inventory: ready({ placements: [placementItem({ capacity: '10' })] }),
  }
  const [row] = rowsFor(data, 'placement-home_banner')
  assert.equal(row.status, STATUS.UNAVAILABLE)
})

// --- resumo operacional -----------------------------------------------------

test('todos os serviços concluídos: "tudo pronto"', () => {
  const data = {
    ...ALL_READY_EMPTY,
    catalog: ready({ items: [offeringItem({ salesEnabled: true })] }),
    inventory: ready({
      placements: [placementItem({ sales_enabled: true, delivery_enabled: true })],
    }),
  }
  const summary = operationalSummary(buildRequirements(data))
  assert.equal(summary.text, 'Tudo pronto — publicidade ativa')
  assert.equal(summary.tone, 'done')
})

test('todos os serviços pausados: nunca declara "tudo pronto"', () => {
  const data = {
    ...ALL_READY_EMPTY,
    evocash: ready({ quotingEnabled: false, checkoutEnabled: false }),
    catalog: ready({ items: [offeringItem()] }),
    inventory: ready({ placements: [placementItem()] }),
  }
  const summary = operationalSummary(buildRequirements(data))
  assert.doesNotMatch(summary.text, /Tudo pronto/)
  assert.match(summary.text, /Sem pendências de configuração/)
  assert.match(summary.text, /4 serviços pausados/, 'quoting + checkout + 1 oferta + 1 espaço')
})

test('mistura de pendente, pausado e concluído: as duas contagens aparecem juntas', () => {
  const data = {
    ...ALL_READY_EMPTY,
    supplier: ready(false), // pending
    evocash: ready({ quotingEnabled: false, checkoutEnabled: true }), // 1 paused, 1 done
  }
  const summary = operationalSummary(buildRequirements(data))
  assert.match(summary.text, /1 configuração pendente/)
  assert.match(summary.text, /1 serviço pausado/)
})

test('fonte indisponível nunca aparece como "tudo pronto"', () => {
  const data = { ...ALL_READY_EMPTY, catalog: errored() }
  const summary = operationalSummary(buildRequirements(data))
  assert.equal(summary.text, 'Não foi possível verificar todos os requisitos')
  assert.equal(summary.tone, 'unavailable')
})

test('pendingCount conta pendente e bloqueado, nunca pausado/indisponível/concluído', () => {
  const data = {
    supplier: ready(false), // pending
    evocash: ready({ quotingEnabled: false, checkoutEnabled: true }), // 1 paused, 1 done
    catalog: ready({
      items: [
        offeringItem({ code: 'a', integrationReady: false, currentPrice: null }),
        offeringItem({ code: 'b', salesEnabled: true }),
      ],
    }), // 1 blocked, 1 done
    inventory: errored(), // unavailable
  }
  assert.equal(
    pendingCount(buildRequirements(data)),
    2,
    'fornecedor pendente + serviço A bloqueado'
  )
})

// --- findCurrentActivation (suporte à revalidação) --------------------------

test('findCurrentActivation encontra a ação específica pelo id, não só a linha', () => {
  const data = { ...ALL_READY_EMPTY, inventory: ready({ placements: [placementItem()] }) }
  const requirements = buildRequirements(data)
  const found = findCurrentActivation(requirements, 'placement-home_banner-delivery')
  assert.equal(found.id, 'placement-home_banner-delivery')
})

test('findCurrentActivation retorna null quando a ação já não existe mais', () => {
  const data = {
    ...ALL_READY_EMPTY,
    catalog: ready({ items: [offeringItem({ salesEnabled: true })] }),
  }
  const requirements = buildRequirements(data)
  assert.equal(
    findCurrentActivation(requirements, 'offering-post_boost-sales'),
    null,
    'já concluído, não há mais ativação pendente'
  )
})

test('findCurrentActivation retorna null quando o serviço foi removido entre a consulta e a ativação', () => {
  const data = { ...ALL_READY_EMPTY, catalog: ready({ items: [] }) }
  const requirements = buildRequirements(data)
  assert.equal(findCurrentActivation(requirements, 'offering-post_boost-sales'), null)
})

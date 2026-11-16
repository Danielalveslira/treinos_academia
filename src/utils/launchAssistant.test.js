import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRequirements, pendingCount, STATUS } from './launchAssistant.js'

const ready = (value) => ({ state: 'ready', value })
const errored = () => ({ state: 'error', value: null })

function rowsFor(data, id) {
  return buildRequirements(data).filter((row) => row.id === id)
}

test('fornecedor configurado é concluído, sem ação', () => {
  const data = {
    supplier: ready(true),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: ready({ items: [] }),
    inventory: ready({ placements: [] }),
  }
  const [row] = rowsFor(data, 'supplier')
  assert.equal(row.status, STATUS.DONE)
  assert.equal(row.action, null)
})

test('fornecedor pendente tem ação de configuração', () => {
  const data = {
    supplier: ready(false),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: ready({ items: [] }),
    inventory: ready({ placements: [] }),
  }
  const [row] = rowsFor(data, 'supplier')
  assert.equal(row.status, STATUS.PENDING)
  assert.ok(row.action?.to)
})

test('falha ao consultar fornecedor nunca aparece como concluído', () => {
  const data = {
    supplier: errored(),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: ready({ items: [] }),
    inventory: ready({ placements: [] }),
  }
  const [row] = rowsFor(data, 'supplier')
  assert.equal(row.status, STATUS.UNAVAILABLE)
  assert.equal(row.action, null)
  assert.equal(row.activation, null)
})

test('cotação e checkout de EvoCash são requisitos independentes', () => {
  const data = {
    supplier: ready(true),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: false }),
    catalog: ready({ items: [] }),
    inventory: ready({ placements: [] }),
  }
  const [quoting] = rowsFor(data, 'evocash-quoting')
  const [checkout] = rowsFor(data, 'evocash-checkout')
  assert.equal(quoting.status, STATUS.DONE)
  assert.equal(checkout.status, STATUS.PAUSED)
  assert.ok(checkout.action?.to)
  assert.equal(checkout.activation, null, 'EvoCash nunca tem ativação direta pelo assistente')
})

test('falha ao consultar EvoCash torna os dois requisitos indisponíveis', () => {
  const data = {
    supplier: ready(true),
    evocash: errored(),
    catalog: ready({ items: [] }),
    inventory: ready({ placements: [] }),
  }
  assert.equal(rowsFor(data, 'evocash-quoting')[0].status, STATUS.UNAVAILABLE)
  assert.equal(rowsFor(data, 'evocash-checkout')[0].status, STATUS.UNAVAILABLE)
})

test('serviço sem integração disponível é bloqueado, com ação de configuração', () => {
  const data = {
    supplier: ready(true),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: ready({
      items: [
        {
          code: 'post_boost',
          name: 'Impulsionar publicação',
          integrationReady: false,
          salesEnabled: false,
          revision: '3',
          currentPrice: null,
        },
      ],
    }),
    inventory: ready({ placements: [] }),
  }
  const [row] = rowsFor(data, 'offering-post_boost')
  assert.equal(row.status, STATUS.BLOCKED)
  assert.ok(row.action?.to)
  assert.equal(row.activation, null)
})

test('serviço integrado sem preço é pendente, com ação de configurar preço', () => {
  const data = {
    supplier: ready(true),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: ready({
      items: [
        {
          code: 'post_boost',
          name: 'Impulsionar publicação',
          integrationReady: true,
          salesEnabled: false,
          revision: '3',
          currentPrice: null,
        },
      ],
    }),
    inventory: ready({ placements: [] }),
  }
  const [row] = rowsFor(data, 'offering-post_boost')
  assert.equal(row.status, STATUS.PENDING)
  assert.equal(row.activation, null, 'sem preço, não é elegível para ativação direta')
})

test('serviço pronto mas com vendas pausadas é elegível para ativação', () => {
  const data = {
    supplier: ready(true),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: ready({
      items: [
        {
          code: 'post_boost',
          name: 'Impulsionar publicação',
          integrationReady: true,
          salesEnabled: false,
          revision: '3',
          currentPrice: { unitPriceCash: '7', minDays: 1, maxDays: 5 },
        },
      ],
    }),
    inventory: ready({ placements: [] }),
  }
  const [row] = rowsFor(data, 'offering-post_boost')
  assert.equal(row.status, STATUS.PAUSED)
  assert.equal(
    row.action,
    null,
    'pronto -- não precisa de link de configuração, só do botão Ativar'
  )
  assert.deepEqual(row.activation, { kind: 'offering', code: 'post_boost', revision: 3 })
})

test('serviço com vendas habilitadas é concluído, sem ativação pendente', () => {
  const data = {
    supplier: ready(true),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: ready({
      items: [
        {
          code: 'post_boost',
          name: 'Impulsionar publicação',
          integrationReady: true,
          salesEnabled: true,
          revision: '3',
          currentPrice: { unitPriceCash: '7', minDays: 1, maxDays: 5 },
        },
      ],
    }),
    inventory: ready({ placements: [] }),
  }
  const [row] = rowsFor(data, 'offering-post_boost')
  assert.equal(row.status, STATUS.DONE)
  assert.equal(row.activation, null)
})

test('falha ao consultar o catálogo gera uma única linha indisponível', () => {
  const data = {
    supplier: ready(true),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: errored(),
    inventory: ready({ placements: [] }),
  }
  const rows = buildRequirements(data).filter((row) => row.category === 'Serviços comerciais')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, STATUS.UNAVAILABLE)
})

test('espaço sem capacidade é pendente, nunca elegível para ativação', () => {
  const data = {
    supplier: ready(true),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: ready({ items: [] }),
    inventory: ready({
      placements: [
        {
          code: 'home_banner',
          name: 'Banner da Home',
          capacity: 0,
          sales_enabled: false,
          delivery_enabled: false,
          revision: 2,
        },
      ],
    }),
  }
  const [row] = rowsFor(data, 'placement-home_banner')
  assert.equal(row.status, STATUS.PENDING)
  assert.equal(row.activation, null)
})

test('espaço com capacidade mas pausado é elegível para ativação', () => {
  const data = {
    supplier: ready(true),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: ready({ items: [] }),
    inventory: ready({
      placements: [
        {
          code: 'home_banner',
          name: 'Banner da Home',
          capacity: 10,
          sales_enabled: false,
          delivery_enabled: true,
          revision: 2,
        },
      ],
    }),
  }
  const [row] = rowsFor(data, 'placement-home_banner')
  assert.equal(row.status, STATUS.PAUSED)
  assert.deepEqual(row.activation, {
    kind: 'placement',
    code: 'home_banner',
    capacity: 10,
    revision: 2,
  })
})

test('espaço com vendas e exibição habilitadas é concluído', () => {
  const data = {
    supplier: ready(true),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: ready({ items: [] }),
    inventory: ready({
      placements: [
        {
          code: 'home_banner',
          name: 'Banner da Home',
          capacity: 10,
          sales_enabled: true,
          delivery_enabled: true,
          revision: 2,
        },
      ],
    }),
  }
  const [row] = rowsFor(data, 'placement-home_banner')
  assert.equal(row.status, STATUS.DONE)
  assert.equal(row.activation, null)
})

test('falha ao consultar o inventário de publicidade gera uma única linha indisponível', () => {
  const data = {
    supplier: ready(true),
    evocash: ready({ quotingEnabled: true, checkoutEnabled: true }),
    catalog: ready({ items: [] }),
    inventory: errored(),
  }
  const rows = buildRequirements(data).filter((row) => row.category === 'Espaços publicitários')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, STATUS.UNAVAILABLE)
})

test('pendingCount conta pendente e bloqueado, nunca pausado/indisponível/concluído', () => {
  const data = {
    supplier: ready(false), // pending
    evocash: ready({ quotingEnabled: false, checkoutEnabled: true }), // 1 paused, 1 done
    catalog: ready({
      items: [
        {
          code: 'a',
          name: 'A',
          integrationReady: false,
          salesEnabled: false,
          revision: '1',
          currentPrice: null,
        }, // blocked
        {
          code: 'b',
          name: 'B',
          integrationReady: true,
          salesEnabled: true,
          revision: '1',
          currentPrice: { unitPriceCash: '1', minDays: 1, maxDays: 1 },
        }, // done
      ],
    }),
    inventory: errored(), // unavailable
  }
  assert.equal(
    pendingCount(buildRequirements(data)),
    2,
    'fornecedor pendente + serviço A bloqueado'
  )
})

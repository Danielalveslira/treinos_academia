import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApprovalItems, filterApprovalItems, TYPE_LABELS, STATUS_LABELS } from './approvalsQueue.js'

// Cobre só a normalização/filtro (módulo puro, sem React): montar ApprovalsQueue.jsx com
// react-test-renderer trava a saída do `node --test` neste projeto assim que a árvore tem
// um efeito assíncrono real (Promise + setState) junto do Dialog do Primer -- um
// MessagePort do pacote `scheduler` fica referenciado e nunca libera o event loop.
// Nenhum outro componente baseado em Dialog (AdminStorefrontView.jsx, por exemplo) tem
// teste de render por esse mesmo motivo; a lógica de negócio fica aqui, isolada.

const AD_SUBMITTED = {
  ad_id: 'ad-1',
  title: 'Oferta pendente',
  partner_name: 'Marca X',
  state: 'submitted',
  moderation_state: 'submitted',
}
const AD_APPROVED_SUSPENDED = {
  ad_id: 'ad-2',
  title: 'Oferta aprovada',
  partner_name: 'Marca Y',
  state: 'approved',
  moderation_state: 'suspended',
}
const AD_DRAFT = {
  ad_id: 'ad-3',
  title: 'Rascunho do anunciante',
  partner_name: 'Marca Z',
  state: 'draft',
  moderation_state: 'draft',
}
const STOREFRONT_SUBMITTED = {
  id: 'store-1',
  name: 'Loja Testada',
  productCount: 1,
  editorialState: 'submitted',
}
const BOOST_REJECTED = {
  id: 'boost-1',
  title: 'Destaque recusado',
  target_type: 'post',
  moderation_state: 'rejected',
}

test('buildApprovalItems normaliza as três categorias e descarta rascunhos', () => {
  const items = buildApprovalItems({
    ads: [AD_SUBMITTED, AD_APPROVED_SUSPENDED, AD_DRAFT],
    storefronts: [STOREFRONT_SUBMITTED],
    boosts: [BOOST_REJECTED],
  })
  assert.equal(items.length, 4, 'o rascunho (ad-3) não aparece na fila')
  assert.deepEqual(
    items.map((i) => i.key),
    ['ad:ad-1', 'ad:ad-2', 'storefront:store-1', 'boost:boost-1']
  )
  const suspendedAd = items.find((i) => i.key === 'ad:ad-2')
  assert.equal(suspendedAd.status, 'approved', 'revisão editorial e veiculação são independentes')
  assert.equal(suspendedAd.suspended, true, 'moderation_state=suspended fica marcado à parte')
})

test('filterApprovalItems aplica o filtro de status (pendente/aprovado/reprovado/todas)', () => {
  const items = buildApprovalItems({
    ads: [AD_SUBMITTED, AD_APPROVED_SUSPENDED],
    storefronts: [STOREFRONT_SUBMITTED],
    boosts: [BOOST_REJECTED],
  })
  assert.deepEqual(
    filterApprovalItems(items, { statusFilter: 'pending', typeFilter: 'all' }).map((i) => i.key),
    ['ad:ad-1', 'storefront:store-1']
  )
  assert.deepEqual(
    filterApprovalItems(items, { statusFilter: 'approved', typeFilter: 'all' }).map((i) => i.key),
    ['ad:ad-2']
  )
  assert.deepEqual(
    filterApprovalItems(items, { statusFilter: 'rejected', typeFilter: 'all' }).map((i) => i.key),
    ['boost:boost-1']
  )
  assert.equal(filterApprovalItems(items, { statusFilter: 'all', typeFilter: 'all' }).length, 4)
})

test('filterApprovalItems aplica o filtro de tipo independentemente do status', () => {
  const items = buildApprovalItems({
    ads: [AD_SUBMITTED, AD_APPROVED_SUSPENDED],
    storefronts: [STOREFRONT_SUBMITTED],
    boosts: [BOOST_REJECTED],
  })
  assert.deepEqual(
    filterApprovalItems(items, { statusFilter: 'all', typeFilter: 'ad' }).map((i) => i.key),
    ['ad:ad-1', 'ad:ad-2']
  )
  assert.deepEqual(filterApprovalItems(items, { statusFilter: 'pending', typeFilter: 'boost' }), [])
})

test('TYPE_LABELS/STATUS_LABELS cobrem todo tipo e status que a fila pode exibir', () => {
  for (const type of ['ad', 'storefront', 'boost']) assert.ok(TYPE_LABELS[type])
  for (const status of ['submitted', 'approved', 'rejected', 'suspended', 'archived'])
    assert.ok(STATUS_LABELS[status])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCashPackagesPresentation,
  computeCommunityCreationCoverage,
  computeSavingsVsBase,
  computeUnitPriceCentavosPer100,
} from './cashPackagePresentation.js'

// Config aprovada no prompt de design persuasivo (implementar_pacotes_evocash_design_
// persuasivo.md) -- os mesmos 4 pacotes que economyConfig/current deve ter.
const PACKAGES = [
  { packageId: 'pack_50', cashAmount: 50, amountCentavos: 590, label: '50 EvoCash', active: true },
  { packageId: 'pack_100', cashAmount: 100, amountCentavos: 990, label: '100 EvoCash', active: true },
  { packageId: 'pack_300', cashAmount: 300, amountCentavos: 2490, label: '300 EvoCash', active: true },
  { packageId: 'pack_700', cashAmount: 700, amountCentavos: 4990, label: '700 EvoCash', active: true },
]

test('buildCashPackagesPresentation orders Essencial, Inicial, Popular, Max regardless of input order', () => {
  const shuffled = [PACKAGES[2], PACKAGES[0], PACKAGES[3], PACKAGES[1]]
  const views = buildCashPackagesPresentation(shuffled)
  assert.deepEqual(
    views.map((view) => view.packageId),
    ['pack_50', 'pack_100', 'pack_300', 'pack_700']
  )
})

test('computeUnitPriceCentavosPer100 matches the worked examples from the design doc', () => {
  assert.equal(computeUnitPriceCentavosPer100(PACKAGES[2]), 830) // Popular: R$8,30/100
  assert.equal(computeUnitPriceCentavosPer100(PACKAGES[3]), 713) // Max: R$7,13/100
  assert.equal(computeUnitPriceCentavosPer100(PACKAGES[1]), 990) // Inicial: preço próprio
})

test('computeSavingsVsBase reproduces the design doc worked examples for Popular and Max', () => {
  const base = PACKAGES[1] // pack_100
  const popularSavings = computeSavingsVsBase(PACKAGES[2], base)
  assert.deepEqual(popularSavings, { savingsCentavos: 480, savingsPercent: 16, comparisonCount: 3 })

  const maxSavings = computeSavingsVsBase(PACKAGES[3], base)
  assert.deepEqual(maxSavings, { savingsCentavos: 1940, savingsPercent: 28, comparisonCount: 7 })
})

test('computeSavingsVsBase never claims a saving for the cheap package (worse unit value than base)', () => {
  const base = PACKAGES[1] // pack_100
  assert.equal(computeSavingsVsBase(PACKAGES[0], base), null)
})

test('computeSavingsVsBase returns null for the base package itself and when there is no base', () => {
  assert.equal(computeSavingsVsBase(PACKAGES[1], PACKAGES[1]), null)
  assert.equal(computeSavingsVsBase(PACKAGES[2], null), null)
})

test('buildCashPackagesPresentation never renders an inactive package', () => {
  const withInactive = [
    ...PACKAGES,
    { packageId: 'pack_old', cashAmount: 10, amountCentavos: 100, label: 'Descontinuado', active: false },
  ]
  const views = buildCashPackagesPresentation(withInactive)
  assert.equal(views.some((view) => view.packageId === 'pack_old'), false)
  assert.equal(views.length, 4)
})

test('an unknown packageId still renders (falls back to the raw label, no crash, sorted last)', () => {
  const withUnknown = [...PACKAGES, { packageId: 'pack_9999', cashAmount: 9999, amountCentavos: 99900, label: '9999 EvoCash', active: true }]
  const views = buildCashPackagesPresentation(withUnknown)
  assert.equal(views.at(-1).packageId, 'pack_9999')
  assert.equal(views.at(-1).title, '9999 EvoCash')
  assert.equal(views.at(-1).badgeText, null)
})

test('Popular is the only curated "Recomendado" pick; Max earns "Melhor valor" from real unit pricing, not a hardcoded badge', () => {
  const views = buildCashPackagesPresentation(PACKAGES)
  const byId = Object.fromEntries(views.map((view) => [view.packageId, view]))
  assert.equal(byId.pack_300.badgeText, 'Recomendado')
  assert.equal(byId.pack_300.recommended, true)
  assert.equal(byId.pack_700.badgeText, 'Melhor valor')
  assert.equal(byId.pack_50.badgeText, null)
  assert.equal(byId.pack_100.badgeText, null)
})

test('if a future config made a cheaper package NOT the curated one, "Melhor valor" follows the real price, not pack_700', () => {
  const cheaperMax = [
    ...PACKAGES.slice(0, 3),
    { packageId: 'pack_700', cashAmount: 700, amountCentavos: 4990, label: '700 EvoCash', active: true },
    { packageId: 'pack_2000', cashAmount: 2000, amountCentavos: 9900, label: '2000 EvoCash', active: true },
  ]
  const views = buildCashPackagesPresentation(cheaperMax)
  const byId = Object.fromEntries(views.map((view) => [view.packageId, view]))
  assert.equal(byId.pack_2000.badgeText, 'Melhor valor')
  assert.equal(byId.pack_700.badgeText, null)
})

test('computeCommunityCreationCoverage matches the design doc example (100 EvoCash covers 2 creations at cashCost 50)', () => {
  assert.equal(computeCommunityCreationCoverage(PACKAGES[1], 50), 2)
  assert.equal(computeCommunityCreationCoverage(PACKAGES[0], 50), 1)
  assert.equal(computeCommunityCreationCoverage(PACKAGES[3], 50), 14)
})

test('computeCommunityCreationCoverage never invents a benefit when the cost is missing or unaffordable', () => {
  assert.equal(computeCommunityCreationCoverage(PACKAGES[1], null), null)
  assert.equal(computeCommunityCreationCoverage(PACKAGES[1], 0), null)
  assert.equal(computeCommunityCreationCoverage({ cashAmount: 10 }, 50), null)
})

test('buildCashPackagesPresentation feeds the community-creation example through to the view', () => {
  const views = buildCashPackagesPresentation(PACKAGES, { communityCreationCashCost: 50 })
  const byId = Object.fromEntries(views.map((view) => [view.packageId, view]))
  assert.equal(byId.pack_100.communityCreationCount, 2)
  assert.equal(byId.pack_700.communityCreationCount, 14)
})

// Restrição ética obrigatória do prompt: nunca afirmar popularidade sem dado real de
// compras. Varre tanto a copy estática (badges/taglines) quanto o resultado calculado,
// pra pegar qualquer regressão futura (alguém adicionando essa frase na metadata).
test('no card copy ever claims "mais escolhido" / "mais comprado" (no real purchase data backs that)', () => {
  const views = buildCashPackagesPresentation(PACKAGES, { communityCreationCashCost: 50 })
  const forbidden = /mais escolhido|mais comprado/i
  for (const view of views) {
    assert.doesNotMatch(view.title || '', forbidden)
    assert.doesNotMatch(view.tagline || '', forbidden)
    assert.doesNotMatch(view.badgeText || '', forbidden)
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCashPackagesPresentation } from './cashPackagePresentation.js'

// Reposicionamento EvoCash como moeda premium/rara -- os 4 pacotes aprovados
// substituem os antigos (50/590, 100/990, 300/2490, 700/4990). packageId é um SKU
// imutável: pack_50_v2/pack_300_v2 nunca reaproveitam pack_50/pack_300, cujos IDs antigos
// já representaram preços diferentes -- reaproveitar arriscaria uma aba com cache antigo
// mostrar um preço e o backend (que resolve preço fresco por packageId) cobrar outro. O
// Max é 300 (não 250) porque alinha ao custo real de community_boost_30d
// (promotionPackages), também 300 EvoCash.
const PACKAGES = [
  { packageId: 'pack_25', cashAmount: 25, amountCentavos: 590, label: '25 EvoCash', active: true },
  { packageId: 'pack_50_v2', cashAmount: 50, amountCentavos: 1090, label: '50 EvoCash', active: true },
  { packageId: 'pack_120', cashAmount: 120, amountCentavos: 2390, label: '120 EvoCash', active: true },
  { packageId: 'pack_300_v2', cashAmount: 300, amountCentavos: 4990, label: '300 EvoCash', active: true },
]

test('buildCashPackagesPresentation orders Essencial, Inicial, Popular, Max regardless of input order', () => {
  const shuffled = [PACKAGES[2], PACKAGES[0], PACKAGES[3], PACKAGES[1]]
  const views = buildCashPackagesPresentation(shuffled)
  assert.deepEqual(
    views.map((view) => view.packageId),
    ['pack_25', 'pack_50_v2', 'pack_120', 'pack_300_v2']
  )
})

test('each package carries its real cashAmount/amountCentavos untouched (backend is the source of truth)', () => {
  const views = buildCashPackagesPresentation(PACKAGES)
  const byId = Object.fromEntries(views.map((view) => [view.packageId, view]))
  assert.equal(byId.pack_25.cashAmount, 25)
  assert.equal(byId.pack_25.amountCentavos, 590)
  assert.equal(byId.pack_50_v2.cashAmount, 50)
  assert.equal(byId.pack_50_v2.amountCentavos, 1090)
  assert.equal(byId.pack_120.cashAmount, 120)
  assert.equal(byId.pack_120.amountCentavos, 2390)
  assert.equal(byId.pack_300_v2.cashAmount, 300)
  assert.equal(byId.pack_300_v2.amountCentavos, 4990)
})

test('titles and taglines match the approved copy', () => {
  const views = buildCashPackagesPresentation(PACKAGES)
  const byId = Object.fromEntries(views.map((view) => [view.packageId, view]))
  assert.equal(byId.pack_25.title, 'Essencial')
  assert.equal(byId.pack_25.tagline, 'Para uma ação pontual')
  assert.equal(byId.pack_50_v2.title, 'Inicial')
  assert.equal(byId.pack_50_v2.tagline, 'Uma boa forma de começar')
  assert.equal(byId.pack_120.title, 'Popular')
  assert.equal(byId.pack_120.tagline, 'Melhor equilíbrio entre preço e saldo')
  assert.equal(byId.pack_300_v2.title, 'Max')
  assert.equal(byId.pack_300_v2.tagline, 'Maior pacote disponível')
})

test('Popular is curated as "Recomendado" (never a popularity claim) and highlighted; Max is curated as "Melhor valor"', () => {
  const views = buildCashPackagesPresentation(PACKAGES)
  const byId = Object.fromEntries(views.map((view) => [view.packageId, view]))
  assert.equal(byId.pack_120.badgeText, 'Recomendado')
  assert.equal(byId.pack_120.recommended, true)
  assert.equal(byId.pack_120.highlight, true)
  assert.equal(byId.pack_300_v2.badgeText, 'Melhor valor')
  assert.equal(byId.pack_25.badgeText, null)
  assert.equal(byId.pack_50_v2.badgeText, null)
})

// Restrição ética obrigatória do prompt original (implementar_pacotes_evocash_design_
// persuasivo.md): nunca afirmar popularidade sem dado real de compras -- "melhor valor"
// e "recomendado" são julgamentos do próprio produto, nunca uma alegação sobre o
// comportamento de outros usuários.
test('no card copy ever claims "mais escolhido" / "mais comprado" (no real purchase data backs that)', () => {
  const views = buildCashPackagesPresentation(PACKAGES)
  const forbidden = /mais escolhido|mais comprado/i
  for (const view of views) {
    assert.doesNotMatch(view.title || '', forbidden)
    assert.doesNotMatch(view.tagline || '', forbidden)
    assert.doesNotMatch(view.badgeText || '', forbidden)
  }
})

// Reposicionamento premium: sem nenhuma matemática comparativa entre pacotes --
// preço-por-100, economia percentual, ou qualquer campo desse tipo não deveriam mais
// existir na view (a raridade vem da quantidade/design, não de desconto calculado).
test('the view never carries unit-price or savings comparison fields anymore', () => {
  const views = buildCashPackagesPresentation(PACKAGES)
  for (const view of views) {
    assert.equal('unitPriceCentavosPer100' in view, false)
    assert.equal('savingsCentavos' in view, false)
    assert.equal('savingsPercent' in view, false)
    assert.equal('communityCreationCount' in view, false)
  }
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
  const withUnknown = [
    ...PACKAGES,
    { packageId: 'pack_9999', cashAmount: 9999, amountCentavos: 99900, label: '9999 EvoCash', active: true },
  ]
  const views = buildCashPackagesPresentation(withUnknown)
  assert.equal(views.at(-1).packageId, 'pack_9999')
  assert.equal(views.at(-1).title, '9999 EvoCash')
  assert.equal(views.at(-1).badgeText, null)
})

test('old package values (50 EvoCash for R$5.90, 100 for R$9.90, 300 for R$24.90, 700 for R$49.90, 250 for R$44.90) are never used', () => {
  const views = buildCashPackagesPresentation(PACKAGES)
  const shapes = views.map((view) => `${view.cashAmount}:${view.amountCentavos}`)
  for (const oldShape of ['50:590', '100:990', '300:2490', '700:4990', '250:4490']) {
    assert.equal(shapes.includes(oldShape), false, `pacote antigo ainda presente: ${oldShape}`)
  }
})

// packageId é um SKU imutável: pack_50/pack_300 antigos já significaram preços
// diferentes (R$5,90 e R$24,90). Reaproveitar os mesmos IDs pros novos preços arriscaria
// uma aba com cache antigo mostrar um preço e o backend cobrar outro pelo mesmo
// packageId -- por isso os novos IDs são pack_50_v2/pack_300_v2, e os antigos nunca
// devem reaparecer na apresentação. pack_250 também não deve existir: o Max foi
// redefinido para 300 EvoCash (não 250), alinhado ao custo de community_boost_30d.
test('the old pack_50/pack_300 IDs are never reused, and pack_250 does not exist -- the new IDs are pack_50_v2/pack_300_v2', () => {
  const views = buildCashPackagesPresentation(PACKAGES)
  const ids = views.map((view) => view.packageId)
  assert.equal(ids.includes('pack_50'), false)
  assert.equal(ids.includes('pack_300'), false)
  assert.equal(ids.includes('pack_250'), false)
  assert.ok(ids.includes('pack_50_v2'))
  assert.ok(ids.includes('pack_300_v2'))
})

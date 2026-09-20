import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Mesmo padrão de RowActionsMenu.test.js (renderToStaticMarkup + ThemeProvider/
// BaseStyles do Primer) combinado com o padrão de interação de WorkoutExerciseGuide.
// test.js (react-test-renderer + act, pra simular o clique real no CTA).
let directory
let renderStatic
let clickBuy
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cash-package-cards-tests-'))
  const outfile = join(directory, 'cards.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { CashPackageCards } from './CashPackageCards.jsx'

        export const renderStatic = (props) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(CashPackageCards, props))))

        export const clickBuy = (props, packageId) => {
          // ThemeProvider do Primer detecta o color-mode do sistema via
          // window.matchMedia -- ausente neste ambiente Node puro (sem jsdom), então
          // um stub mínimo evita o crash sem simular um browser inteiro.
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({
            matches: false,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
          }))
          global.document = global.document || {
            addEventListener: () => {},
            removeEventListener: () => {},
          }
          let component
          act(() => {
            component = TestRenderer.create(createElement(ThemeProvider, null,
              createElement(BaseStyles, null, createElement(CashPackageCards, props))))
          })
          act(() => {
            component.root.findByProps({ 'data-testid': \`buy-\${packageId}\` }).props.onClick()
          })
          component.unmount()
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  })
  ;({ renderStatic, clickBuy } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

// Reposicionamento EvoCash como moeda premium/rara -- os 4 pacotes aprovados. IDs de 50 e
// 300 EvoCash são pack_50_v2/pack_300_v2 (não pack_50/pack_300): packageId é um SKU
// imutável, e os IDs antigos já representaram preços diferentes (R$5,90 e R$24,90). Max é
// 300 (não 250) EvoCash, alinhado ao custo de community_boost_30d.
const PACKAGES = [
  { packageId: 'pack_25', cashAmount: 25, amountCentavos: 590, label: '25 EvoCash', active: true },
  { packageId: 'pack_50_v2', cashAmount: 50, amountCentavos: 1090, label: '50 EvoCash', active: true },
  { packageId: 'pack_120', cashAmount: 120, amountCentavos: 2390, label: '120 EvoCash', active: true },
  { packageId: 'pack_300_v2', cashAmount: 300, amountCentavos: 4990, label: '300 EvoCash', active: true },
]

test('renders all 4 active packages, in order, each with its real price and a CTA', () => {
  const html = renderStatic({ packages: PACKAGES, onBuy: () => {} })
  assert.match(html, />Essencial</)
  assert.match(html, />Inicial</)
  assert.match(html, />Popular</)
  assert.match(html, />Max</)
  assert.match(html, /R\$\s?5,90/)
  assert.match(html, /R\$\s?10,90/)
  assert.match(html, /R\$\s?23,90/)
  assert.match(html, /R\$\s?49,90/)
  assert.equal((html.match(/Comprar por/g) || []).length, 4)
  const essencialIndex = html.indexOf('>Essencial<')
  const inicialIndex = html.indexOf('>Inicial<')
  const popularIndex = html.indexOf('>Popular<')
  const maxIndex = html.indexOf('>Max<')
  assert.ok(essencialIndex < inicialIndex)
  assert.ok(inicialIndex < popularIndex)
  assert.ok(popularIndex < maxIndex)
})

// R$49,90 sozinho não é mais uma prova de pacote antigo: coincide com o preço do novo
// Max (300 EvoCash), que antes pertencia ao pack_700 (700 EvoCash). Por isso a checagem
// aqui é por quantidade+preço, não só pelo preço isolado.
test('never renders the old package prices/quantities (9,90/100 · 24,90/300 · 700 EvoCash for 49,90)', () => {
  const html = renderStatic({ packages: PACKAGES, onBuy: () => {} })
  assert.doesNotMatch(html, /R\$\s?9,90/)
  assert.doesNotMatch(html, /R\$\s?24,90/)
  assert.doesNotMatch(html, />700 EvoCash</)
})

test('an inactive package never renders as a card', () => {
  const html = renderStatic({
    packages: [
      ...PACKAGES,
      { packageId: 'pack_old', cashAmount: 10, amountCentavos: 100, label: 'Descontinuado', active: false },
    ],
    onBuy: () => {},
  })
  assert.doesNotMatch(html, /Descontinuado/)
  assert.equal((html.match(/Comprar por/g) || []).length, 4)
})

test('Popular is visually recommended and Max shows "Melhor valor" -- never "Mais escolhido"/"Mais comprado"', () => {
  const html = renderStatic({ packages: PACKAGES, onBuy: () => {} })
  assert.match(html, /Recomendado/)
  assert.match(html, /Melhor valor/)
  assert.doesNotMatch(html, /Mais escolhido/i)
  assert.doesNotMatch(html, /Mais comprado/i)
})

test('taglines match the approved copy for each tier', () => {
  const html = renderStatic({ packages: PACKAGES, onBuy: () => {} })
  assert.match(html, /Para uma ação pontual/)
  assert.match(html, /Uma boa forma de começar/)
  assert.match(html, /Melhor equilíbrio entre preço e saldo/)
  assert.match(html, /Maior pacote disponível/)
})

// Reposicionamento premium: sem matemática comparativa entre pacotes -- nem "R$X por
// 100 EvoCash", nem "Economize R$X"/"~X% melhor valor", nem "cobre N criações de
// comunidade". A raridade vem da própria quantidade oferecida e do design.
test('never shows unit-price framing, savings copy, or community-creation coverage math', () => {
  const html = renderStatic({ packages: PACKAGES, onBuy: () => {} })
  assert.doesNotMatch(html, /por 100 EvoCash/)
  assert.doesNotMatch(html, /Economize/)
  assert.doesNotMatch(html, /melhor valor.*calculad|%\s*melhor valor/i)
  assert.doesNotMatch(html, /cria(ç|c)(ã|a)o de comunidade/i)
})

test('shows the trust/security line near the purchase area, with no investment-like language', () => {
  const html = renderStatic({ packages: PACKAGES, onBuy: () => {} })
  assert.match(html, /PIX/)
  assert.match(html, /crédito confirmado após validação/i)
  assert.doesNotMatch(html, /rendimento|investimento|saque|convers[aã]o para dinheiro/i)
})

test('clicking a card CTA sends exactly that card packageId to onBuy, never another one', () => {
  const calls = []
  globalThis.__onBuy = (packageId) => calls.push(packageId)
  clickBuy({ packages: PACKAGES, onBuy: (id) => globalThis.__onBuy(id) }, 'pack_120')
  clickBuy({ packages: PACKAGES, onBuy: (id) => globalThis.__onBuy(id) }, 'pack_300_v2')
  assert.deepEqual(calls, ['pack_120', 'pack_300_v2'])
  delete globalThis.__onBuy
})

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

const PACKAGES = [
  { packageId: 'pack_50', cashAmount: 50, amountCentavos: 590, label: '50 EvoCash', active: true },
  { packageId: 'pack_100', cashAmount: 100, amountCentavos: 990, label: '100 EvoCash', active: true },
  { packageId: 'pack_300', cashAmount: 300, amountCentavos: 2490, label: '300 EvoCash', active: true },
  { packageId: 'pack_700', cashAmount: 700, amountCentavos: 4990, label: '700 EvoCash', active: true },
]

test('renders all 4 active packages, in order, each with its real price and a CTA', () => {
  const html = renderStatic({ packages: PACKAGES, onBuy: () => {} })
  assert.match(html, />Essencial</)
  assert.match(html, />Inicial</)
  assert.match(html, />Popular</)
  assert.match(html, />Max</)
  assert.match(html, /R\$\s?5,90/)
  assert.match(html, /R\$\s?9,90/)
  assert.match(html, /R\$\s?24,90/)
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

test('an inactive package never renders as a card', () => {
  const html = renderStatic({
    packages: [...PACKAGES, { packageId: 'pack_old', cashAmount: 10, amountCentavos: 100, label: 'Descontinuado', active: false }],
    onBuy: () => {},
  })
  assert.doesNotMatch(html, /Descontinuado/)
  assert.equal((html.match(/Comprar por/g) || []).length, 4)
})

test('Popular is visually recommended and Max earns "Melhor valor" from real pricing -- never "Mais escolhido"', () => {
  const html = renderStatic({ packages: PACKAGES, onBuy: () => {} })
  assert.match(html, /Recomendado/)
  assert.match(html, /Melhor valor/)
  assert.doesNotMatch(html, /Mais escolhido/i)
  assert.doesNotMatch(html, /Mais comprado/i)
})

test('shows the value-per-100 framing and the computed savings copy for Popular/Max', () => {
  const html = renderStatic({ packages: PACKAGES, onBuy: () => {} })
  assert.match(html, /R\$\s?8,30 por 100 EvoCash/)
  assert.match(html, /R\$\s?7,13 por 100 EvoCash/)
  assert.match(html, /Economize R\$\s?4,80/)
  assert.match(html, /Economize R\$\s?19,40/)
  assert.match(html, /28% melhor valor/)
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
  clickBuy({ packages: PACKAGES, onBuy: (id) => globalThis.__onBuy(id) }, 'pack_300')
  clickBuy({ packages: PACKAGES, onBuy: (id) => globalThis.__onBuy(id) }, 'pack_700')
  assert.deepEqual(calls, ['pack_300', 'pack_700'])
  delete globalThis.__onBuy
})

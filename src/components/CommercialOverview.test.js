import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Etapa A: o Início consulta só getCommercialPendingCounts (uma RPC, um card de
// aprovações consolidado -- anúncios+vitrines+impulsionamentos -- e um card de
// reembolsos, separado por ser operação financeira). Nenhuma lista completa de
// anúncios/vitrines/reembolsos é carregada aqui; essas listas continuam existindo
// normalmente em Aprovações/Publicidade/Financeiro.
let directory
let mount
let calls

const STUBS = {
  commercialOverviewService: `export const getCommercialPendingCounts = () => { globalThis.__coCalls.push(1); return globalThis.__coCounts() }`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'commercial-overview-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import CommercialOverview from './CommercialOverview.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : (n.children || []).map(textOf).join(''))
        function allNodes(tree) {
          if (!tree || typeof tree !== 'object') return []
          const children = tree.children
          return [
            tree,
            ...(Array.isArray(children) ? children : [children]).flatMap(allNodes),
          ]
        }
        function nodes(tree, type) {
          return allNodes(tree).filter((n) => n.type === type)
        }
        export function mountPage() {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(MemoryRouter, null, React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(CommercialOverview)))))
          })
          return {
            text: () => textOf(renderer.toJSON()),
            links: () => nodes(renderer.toJSON(), 'a').map((n) => ({ href: n.props.href, text: textOf(n) })),
            headings: () => nodes(renderer.toJSON(), 'h2').map(textOf),
            alerts: () => allNodes(renderer.toJSON()).filter((n) => n.props?.role === 'alert').map(textOf),
            unmount: () => act(() => renderer.unmount()),
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.css': 'empty' },
    define: { 'import.meta.env': '{}' },
    plugins: [
      {
        name: 'stubs',
        setup(b) {
          for (const name of Object.keys(STUBS)) {
            b.onResolve({ filter: new RegExp(`(^|/)${name}(\\.jsx?)?$`) }, () => ({
              path: name,
              namespace: 'stub',
            }))
          }
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            contents: STUBS[args.path],
            resolveDir: root,
            loader: 'jsx',
          }))
        },
      },
    ],
  })
  ;({ mountPage: mount } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 30))

function configure(resolveValue, rejectValue) {
  calls = []
  globalThis.__coCalls = calls
  globalThis.__coCounts = () =>
    rejectValue ? Promise.reject(rejectValue) : Promise.resolve(resolveValue)
}

test('total consolidado soma anúncios, vitrines e impulsionamentos (não reembolsos)', async () => {
  configure({ pendingAds: 3, pendingStorefronts: 1, pendingBoosts: 2, openRefunds: 9 })
  const page = mount()
  await tick()
  assert.match(
    page.text(),
    /6 pendentes/,
    'total de aprovações é 3+1+2=6, nunca somando reembolsos'
  )
  page.unmount()
})

test('detalha pendingAds, pendingStorefronts e pendingBoosts no card de aprovações', async () => {
  configure({ pendingAds: 3, pendingStorefronts: 1, pendingBoosts: 2, openRefunds: 0 })
  const page = mount()
  await tick()
  assert.match(page.text(), /3 anúncios/)
  assert.match(page.text(), /1 vitrine\b/)
  assert.match(page.text(), /2 impulsionamentos/)
  page.unmount()
})

test('exibe openRefunds no card de reembolsos, separado das aprovações', async () => {
  configure({ pendingAds: 0, pendingStorefronts: 0, pendingBoosts: 0, openRefunds: 5 })
  const page = mount()
  await tick()
  const text = page.text()
  assert.match(text, /Reembolsos em andamento/)
  assert.match(text, /5 pendentes/)
  page.unmount()
})

test('zero pendências reais mostra 0, não omite nem trata como erro', async () => {
  configure({ pendingAds: 0, pendingStorefronts: 0, pendingBoosts: 0, openRefunds: 0 })
  const page = mount()
  await tick()
  assert.match(page.text(), /0 pendentes/)
  assert.doesNotMatch(page.text(), /Não foi possível/)
  page.unmount()
})

test('falha de consulta nunca aparece como zero pendências', async () => {
  configure(null, new Error('boom'))
  const page = mount()
  await tick()
  assert.match(page.text(), /Não foi possível consultar estes dados\./)
  assert.doesNotMatch(page.text(), /0 pendentes/)
  assert.doesNotMatch(
    page.text(),
    /\d+ pendentes/,
    'nenhum número de pendência aparece em estado de erro'
  )
  assert.deepEqual(
    page.alerts().length > 0,
    true,
    'erro é anunciado com role=alert para leitores de tela'
  )
  page.unmount()
})

test('resposta incompleta (campo ausente) é tratada como falha, não como zero', async () => {
  configure({ pendingAds: 3, pendingStorefronts: 1, openRefunds: 0 }) // falta pendingBoosts
  const page = mount()
  await tick()
  assert.match(page.text(), /Não foi possível consultar estes dados\./)
  assert.doesNotMatch(page.text(), /NaN/)
  page.unmount()
})

test('resposta inválida (tipo errado) é tratada como falha, não como zero', async () => {
  configure({ pendingAds: '3', pendingStorefronts: 1, pendingBoosts: 2, openRefunds: 0 })
  const page = mount()
  await tick()
  assert.match(page.text(), /Não foi possível consultar estes dados\./)
  page.unmount()
})

test('estado de carregamento aparece antes da resposta chegar', async () => {
  calls = []
  globalThis.__coCalls = calls
  let resolvePending
  globalThis.__coCounts = () => new Promise((resolve) => (resolvePending = resolve))
  const page = mount()
  assert.doesNotMatch(
    page.text(),
    /\d+ pendente/,
    'título estático contém "pendentes", mas nenhum número ainda'
  )
  resolvePending({ pendingAds: 0, pendingStorefronts: 0, pendingBoosts: 0, openRefunds: 0 })
  await tick()
  page.unmount()
})

test('card de aprovações pendentes linka direto para a área de Aprovações', async () => {
  configure({ pendingAds: 1, pendingStorefronts: 0, pendingBoosts: 0, openRefunds: 0 })
  const page = mount()
  await tick()
  const link = page.links().find((l) => l.text === 'Ver aprovações')
  assert.equal(link?.href, '/admin/parcerias?area=aprovacoes')
  page.unmount()
})

test('card de reembolsos linka direto para o financeiro', async () => {
  configure({ pendingAds: 0, pendingStorefronts: 0, pendingBoosts: 0, openRefunds: 1 })
  const page = mount()
  await tick()
  const link = page.links().find((l) => l.text === 'Consultar reembolsos')
  assert.equal(link?.href, '/admin/compras-evocash?tab=refunds')
  page.unmount()
})

test('nunca importa serviços de listagem completa (anúncios, vitrines, reembolsos)', async () => {
  const source = await readFile(new URL('./CommercialOverview.jsx', import.meta.url), 'utf8')
  for (const forbidden of ['advertisingService', 'storefrontService', 'refundService']) {
    assert.doesNotMatch(
      source,
      new RegExp(forbidden),
      `CommercialOverview.jsx não deve mais importar ${forbidden}`
    )
  }
})

test('monta com exatamente uma consulta de resumo', async () => {
  configure({ pendingAds: 1, pendingStorefronts: 0, pendingBoosts: 0, openRefunds: 0 })
  const page = mount()
  await tick()
  assert.equal(
    calls.length,
    1,
    'getCommercialPendingCounts é chamada exatamente uma vez por montagem'
  )
  page.unmount()
})

test('permanece com lazy loading em AdminSponsoredAds.jsx', async () => {
  const source = await readFile(new URL('../pages/AdminSponsoredAds.jsx', import.meta.url), 'utf8')
  assert.match(
    source,
    /const CommercialOverview = lazy\(\(\) => import\(['"]\.\.\/components\/CommercialOverview['"]\)\)/,
    'CommercialOverview continua em um chunk próprio, carregado só ao abrir a área'
  )
})

test('cada cartão expõe um título semântico (acessibilidade básica)', async () => {
  configure({ pendingAds: 1, pendingStorefronts: 0, pendingBoosts: 0, openRefunds: 2 })
  const page = mount()
  await tick()
  assert.deepEqual(page.headings().sort(), ['Aprovações pendentes', 'Reembolsos em andamento'])
  page.unmount()
})

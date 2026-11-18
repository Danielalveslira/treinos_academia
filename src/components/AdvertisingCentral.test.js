import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Redesign da listagem (PROMPT_EVOLUTUS_REESTRUTURACAO_PUBLICIDADE.md, seção 4.1): filtro
// real no backend (nunca recorte client-side dos 20 itens carregados), resumo de contagens
// e paginação que preserva o filtro ativo. AdStatusCard/CreateAdWizard são stubs -- o que
// importa aqui é a própria lógica de busca/filtro/paginação de AdvertisingCentral.
let directory
let mount

const STUBS = {
  advertisingService: `
    export const getAdvertisingCampaigns = (accountId, after = null, status = null) =>
      globalThis.__acGetCampaigns(accountId, after, status)
    export const getAdvertisingCampaignsSummary = (accountId) => globalThis.__acGetSummary(accountId)
  `,
  AdStatusCard: `export default function AdStatusCard({ campaign }) { return <div>{campaign.title}</div> }`,
  CreateAdWizard: `export default function CreateAdWizard() { return null }`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'advertising-central-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import AdvertisingCentral from './AdvertisingCentral.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : (n.children || []).map(textOf).join(''))
        export function mountPage(props) {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(AdvertisingCentral, props))))
          })
          const root = renderer.root
          const findAllButtons = () => root.findAll((n) => n.type === 'button')
          return {
            text: () => textOf(renderer.toJSON()),
            clickButton: (label) => {
              const item = findAllButtons().find((n) => textOf(n).trim() === label || n.props['aria-label'] === label)
              act(() => item.props.onClick())
            },
            isPressed: (label) => findAllButtons().find((n) => textOf(n).trim() === label)?.props['aria-pressed'],
            selectOther: (ariaLabel, value) => {
              const item = root.findAll((n) => n.type === 'select' && n.props['aria-label'] === ariaLabel)[0]
              act(() => item.props.onChange({ target: { value } }))
            },
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

function ad(id, title) {
  return { ad_id: id, title, version: 1, moderation_state: 'approved' }
}

test('carrega sem filtro (p_status null) e mostra o resumo real', async () => {
  const calls = []
  globalThis.__acGetCampaigns = (accountId, after, status) => {
    calls.push({ accountId, after, status })
    return Promise.resolve([ad('ad-1', 'Campanha 1')])
  }
  globalThis.__acGetSummary = () => Promise.resolve({ total: 5, live: 2, submitted: 1 })

  const page = mount({ accountId: 'acc-1', accountName: 'Marca' })
  await tick()
  assert.deepEqual(calls, [{ accountId: 'acc-1', after: null, status: null }])
  assert.match(page.text(), /Total: 5 · Ativos: 2 · Em análise: 1/)
  assert.match(page.text(), /Campanha 1/)
  page.unmount()
})

test('clicar em um filtro primário refaz a busca com p_status e substitui a lista (nunca recorta no cliente)', async () => {
  const calls = []
  globalThis.__acGetCampaigns = (accountId, after, status) => {
    calls.push({ after, status })
    if (status === 'live') return Promise.resolve([ad('ad-live-1', 'Ativa 1')])
    return Promise.resolve([ad('ad-1', 'Campanha 1'), ad('ad-2', 'Campanha 2')])
  }
  globalThis.__acGetSummary = () => Promise.resolve({ total: 2, live: 1, submitted: 0 })

  const page = mount({ accountId: 'acc-2', accountName: 'Marca' })
  await tick()
  assert.equal(page.isPressed('Todos'), true)
  page.clickButton('Ativos')
  await tick()
  assert.equal(calls.at(-1).status, 'live')
  assert.match(page.text(), /Ativa 1/)
  assert.doesNotMatch(page.text(), /Campanha 1/, 'a lista anterior some, não fica misturada com a filtrada')
  assert.equal(page.isPressed('Ativos'), true)
  assert.equal(page.isPressed('Todos'), false)
  page.unmount()
})

test('filtro complementar busca por uma situação fora das quatro primárias', async () => {
  const calls = []
  globalThis.__acGetCampaigns = (accountId, after, status) => {
    calls.push(status)
    return Promise.resolve(status === 'paused' ? [ad('ad-paused-1', 'Pausada 1')] : [])
  }
  globalThis.__acGetSummary = () => Promise.resolve({ total: 1, live: 0, submitted: 0 })

  const page = mount({ accountId: 'acc-3', accountName: 'Marca' })
  await tick()
  page.selectOther('Outras situações', 'paused')
  await tick()
  assert.equal(calls.at(-1), 'paused')
  assert.match(page.text(), /Pausada 1/)
  page.unmount()
})

test('sem nenhum anúncio na conta mostra a mensagem de primeiro uso; filtrado e vazio mostra outra mensagem', async () => {
  globalThis.__acGetCampaigns = () => Promise.resolve([])
  globalThis.__acGetSummary = () => Promise.resolve({ total: 0, live: 0, submitted: 0 })
  const page = mount({ accountId: 'acc-4', accountName: 'Marca' })
  await tick()
  assert.match(page.text(), /Você ainda não criou nenhum anúncio/)
  page.clickButton('Encerrados')
  await tick()
  assert.match(page.text(), /Nenhum anúncio nessa situação agora/)
  page.unmount()
})

test('um resumo indisponível nunca impede ver a listagem real', async () => {
  globalThis.__acGetCampaigns = () => Promise.resolve([ad('ad-1', 'Campanha 1')])
  globalThis.__acGetSummary = () => Promise.reject(new Error('PERMISSION_DENIED'))
  const page = mount({ accountId: 'acc-5', accountName: 'Marca' })
  await tick()
  assert.match(page.text(), /Campanha 1/)
  assert.doesNotMatch(page.text(), /Total:/)
  page.unmount()
})

test('"Carregar mais" usa o cursor real e preserva o filtro ativo', async () => {
  const calls = []
  globalThis.__acGetCampaigns = (accountId, after, status) => {
    calls.push({ after, status })
    if (after) return Promise.resolve([ad('ad-21', 'Campanha 21')])
    return Promise.resolve(Array.from({ length: 20 }, (_, i) => ad('ad-' + i, 'Campanha ' + i)))
  }
  globalThis.__acGetSummary = () => Promise.resolve({ total: 21, live: 21, submitted: 0 })
  const page = mount({ accountId: 'acc-6', accountName: 'Marca' })
  await tick()
  page.clickButton('Ativos')
  await tick()
  page.clickButton('Carregar mais anúncios')
  await tick()
  assert.equal(calls.at(-1).after, 'ad-19')
  assert.equal(calls.at(-1).status, 'live')
  assert.match(page.text(), /Campanha 21/)
  page.unmount()
})

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Página Central comercial: seção Publicidade com abas Campanhas/Resultados. Dependências de dados são stubs;
// a aba Resultados é um stub que registra quando é montada (a leitura real só acontece dentro dela).
let directory
let mount

const STUBS = {
  useAdminSponsoredAds: `export function useAdminSponsoredAds() {
    return { ads: globalThis.__adminAdsOverride ?? [{ id: 'a1', title: 'Oferta', partnerName: 'Marca', communityIds: [], isGlobal: true, displayMode: ['banner'], expiresAt: null, deliveryStatus: 'delivering' }],
      loading: false, error: null, refresh() {}, add() {}, edit() {}, remove() {} } }`,
  useAdminCommunities: `export function useAdminCommunities() { return { communities: [{ id: 'c1', name: 'Com' }] } }`,
  useAuth: `export function useAuth() { return { user: { uid: 'admin-1' } } }`,
  useToast: `export function useToast() { return { toasts: [], showToast() {} } }`,
  useConfirmDelete: `export function useConfirmDelete() { return async () => true }`,
  InstitutionalAdForm: `import { createElement } from 'react'
    export function InstitutionalAdForm({ initialValue }) { return createElement('form', { 'data-testid': 'ad-form' }, initialValue ? 'editar' : 'novo') }`,
  ErrorState: `export function ErrorState() { return null }`,
  ToastFlash: `export function ToastFlash() { return null }`,
  RowActionsMenu: `export function RowActionsMenu() { return null }`,
  // AdminNav usa ActionMenu/Portal do Primer (precisa de document.createElement real,
  // ver o shim em AdminAccounts.test.js) -- fora de escopo aqui, mesmo tratamento de
  // RowActionsMenu. Cobertura própria em AdminNav.test.js e AdminAccounts.test.js.
  AdminNav: `export default function AdminNav() { return null }`,
  AdMetricsTab: `import { useEffect, createElement } from 'react'
    export default function AdMetricsTab({ userId, ads }) {
      useEffect(() => { globalThis.__metricsMounts = (globalThis.__metricsMounts || 0) + 1 }, [])
      return createElement('div', { 'data-testid': 'metrics-tab' }, 'métricas de ' + userId + ' / ' + ads.length + ' campanhas')
    }`,
  CommercialOverview: `import { createElement } from 'react'
    export default function CommercialOverview() { return createElement('div', { 'data-testid': 'commercial-overview' }, 'Visão geral comercial') }`,
  // PR1: as 4 áreas abrem o conteúdo real na primeira renderização, sem cartão
  // "Abrir" intermediário -- estes stubs só provam que o componente real monta.
  CommercialAdmin: `import { createElement } from 'react'
    export default function CommercialAdmin() { return createElement('div', { 'data-testid': 'commercial-admin' }, 'Vitrines e parceiros (CommercialAdmin real)') }`,
  CommercialEngineAdmin: `import { createElement } from 'react'
    export default function CommercialEngineAdmin() { return createElement('div', { 'data-testid': 'commercial-engine-admin' }, 'Preços e contratações (motor real)') }`,
  AdvertisingAdmin: `import { createElement } from 'react'
    export default function AdvertisingAdmin() { return createElement('div', { 'data-testid': 'advertising-admin' }, 'Canais de publicidade (real)') }`,
  SupplierInfoGateAdmin: `import { createElement } from 'react'
    export default function SupplierInfoGateAdmin() { return createElement('div', { 'data-testid': 'supplier-info-gate-admin' }, 'Avançado: identificação do fornecedor (real)') }`,
  AdvertiserAdmin: `import { createElement } from 'react'
    export default function AdvertiserAdmin() { return createElement('div', { 'data-testid': 'advertiser-admin' }, 'Anunciantes (real)') }`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'admin-ads-page-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import AdminSponsoredAds from './AdminSponsoredAds.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : (n.children || []).map(textOf).join(''))
        export function mountPage(path = '/admin/parcerias') {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          globalThis.__metricsMounts = 0
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(React.Suspense, { fallback: 'carregando' }, React.createElement(AdminSponsoredAds))))))
          })
          const root = renderer.root
          return {
            text: () => textOf(renderer.toJSON()),
            hasNovo: () => root.findAll((n) => n.type === 'button' && textOf(n).trim() === 'Novo').length > 0,
            tabs: () => root.findAll((n) => n.props && n.props['aria-current'] !== undefined || (n.props && n.props.onSelect && n.type === 'button')),
            selectTab: (label) => {
              const item = root.findAll((n) => typeof n.props.onSelect === 'function' && textOf(n).includes(label))[0]
              act(() => item.props.onSelect({ preventDefault() {} }))
            },
            wrapperHidden: (testid) => {
              const el = root.findAll((n) => n.props && n.props['data-testid'] === testid)[0]
              if (!el) return null
              let node = el
              while (node) { if (node.props && node.props.hidden !== undefined) return Boolean(node.props.hidden); node = node.parent }
              return false
            },
            mounts: () => globalThis.__metricsMounts,
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
            b.onResolve({ filter: new RegExp(`(^|/)${name}(\\\\.jsx?)?$`) }, () => ({
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

test('abre na Visão geral sem montar campanhas nem métricas', async () => {
  const page = mount()
  await tick()
  assert.match(page.text(), /Central comercial/)
  assert.match(page.text(), /Visão geral comercial/)
  assert.match(page.text(), /Publicidade/)
  assert.doesNotMatch(page.text(), /Oferta/)
  assert.equal(page.hasNovo(), false)
  assert.equal(page.mounts(), 0, 'o módulo de métricas nem foi carregado')
  assert.equal(page.wrapperHidden('metrics-tab'), null)
  page.unmount()
})

test('link legado de Campanhas e aba Resultados preservam a navegação e o cache', async () => {
  const page = mount('/admin/parcerias?tab=campaigns')
  await tick()
  assert.match(page.text(), /Oferta/)
  assert.equal(page.hasNovo(), true)
  page.selectTab('Resultados')
  await tick()
  assert.equal(page.mounts(), 1)
  assert.match(page.text(), /métricas de admin-1 \/ 1 campanhas/)
  assert.equal(page.hasNovo(), false, '+ Novo só aparece em Campanhas')
  assert.equal(page.wrapperHidden('metrics-tab'), false)
  page.selectTab('Campanhas')
  await tick()
  assert.equal(page.hasNovo(), true)
  assert.equal(
    page.wrapperHidden('metrics-tab'),
    true,
    'aba de métricas fica escondida, mantendo estado e cache'
  )
  page.selectTab('Resultados')
  await tick()
  assert.equal(page.mounts(), 1, 'reabrir não monta de novo')
  page.unmount()
})

test('link de relatório abre Resultados diretamente sem montar a lista visual de campanhas', async () => {
  const page = mount('/admin/parcerias?report=metrics&adId=campanha-1')
  await tick()
  assert.equal(page.mounts(), 1)
  assert.equal(page.hasNovo(), false)
  assert.equal(page.wrapperHidden('metrics-tab'), false)
  page.unmount()
})

test('estados de entrega vêm do servidor e validade não ganha selo duplicado', async () => {
  globalThis.__adminAdsOverride = ['delivering', 'partial', 'paused', 'suspended', 'expired'].map(
    (deliveryStatus, index) => ({
      id: `ad-${index}`,
      title: `Anúncio ${index}`,
      partnerName: 'Marca',
      placements: [],
      deliveryStatus,
      active: index < 3,
      expiresAt: deliveryStatus === 'expired' ? '2020-01-01T00:00:00Z' : null,
    })
  )
  const page = mount('/admin/parcerias?tab=campaigns')
  await tick()
  for (const label of [
    'Em exibição',
    'Exibição parcial',
    'Exibição pausada',
    'Suspenso',
    'Expirado',
  ]) {
    assert.match(page.text(), new RegExp(label))
  }
  assert.equal((page.text().match(/Expirado/g) || []).length, 1)
  page.unmount()
  delete globalThis.__adminAdsOverride
})

test('lista vazia oferece um único caminho de criação', async () => {
  globalThis.__adminAdsOverride = []
  const page = mount('/admin/parcerias?tab=campaigns')
  await tick()
  assert.equal(page.hasNovo(), false)
  assert.match(page.text(), /Criar anúncio/)
  page.unmount()
  delete globalThis.__adminAdsOverride
})

// PR1: Publicidade > Vitrines e Financeiro (motor/avançado) renderizam o conteúdo real
// na primeira renderização -- nenhuma das quatro áreas é mais um cartão "Abrir".
test('Publicidade > Vitrines e parceiros abre o CommercialAdmin direto, sem cartão intermediário', async () => {
  const page = mount('/admin/parcerias?area=publicidade&tab=vitrines')
  await tick()
  assert.match(page.text(), /Vitrines e parceiros \(CommercialAdmin real\)/)
  assert.doesNotMatch(page.text(), /Abrir/)
  page.unmount()
})

test('Publicidade > Canais abre o AdvertisingAdmin direto', async () => {
  const page = mount('/admin/parcerias?area=publicidade&tab=canais')
  await tick()
  assert.match(page.text(), /Canais de publicidade \(real\)/)
  page.unmount()
})

test('Financeiro abre o motor comercial direto (aba padrão), com link claro para compras-evocash', async () => {
  const page = mount('/admin/parcerias?area=financeiro')
  await tick()
  assert.match(page.text(), /Preços e contratações \(motor real\)/)
  assert.match(page.text(), /Compras de EvoCash/)
  assert.doesNotMatch(page.text(), /identificação do fornecedor/)
  page.unmount()
})

test('Financeiro > Avançado abre o gate de fornecedor sob demanda', async () => {
  const page = mount('/admin/parcerias?area=financeiro&tab=avancado')
  await tick()
  assert.match(page.text(), /identificação do fornecedor \(real\)/)
  assert.doesNotMatch(page.text(), /motor real/, 'o motor comercial não é montado sem necessidade')
  page.unmount()
})

// Compatibilidade com links antigos: favoritos/relatórios salvos antes do PR1 continuam
// abrindo a área/aba equivalente, sem precisar de um segundo clique para ver conteúdo.
test('alias legado ?section=storefronts&tab=commercial abre Vitrines e parceiros direto', async () => {
  const page = mount('/admin/parcerias?section=storefronts&tab=commercial')
  await tick()
  assert.match(page.text(), /Vitrines e parceiros \(CommercialAdmin real\)/)
  page.unmount()
})

test('alias legado ?section=finance&tab=engine abre o motor comercial direto', async () => {
  const page = mount('/admin/parcerias?section=finance&tab=engine')
  await tick()
  assert.match(page.text(), /Preços e contratações \(motor real\)/)
  page.unmount()
})

test('alias legado bare ?tab=commercial (sem section) resolve para Publicidade > Vitrines', async () => {
  const page = mount('/admin/parcerias?tab=commercial')
  await tick()
  assert.match(page.text(), /Vitrines e parceiros \(CommercialAdmin real\)/)
  page.unmount()
})

test('alias legado bare ?tab=engine (sem section) resolve para Financeiro', async () => {
  const page = mount('/admin/parcerias?tab=engine')
  await tick()
  assert.match(page.text(), /Preços e contratações \(motor real\)/)
  page.unmount()
})

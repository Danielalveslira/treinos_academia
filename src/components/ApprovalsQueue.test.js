import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// PR2: contadores reais e paginação de verdade na fila de aprovações. Dependências
// de rede são stubs controlados pelo próprio teste (globalThis.__aq*); AuthCaptcha e
// StorefrontImage são stubados porque só aparecem dentro do diálogo de revisão, que
// estes testes não abrem (focados em listagem/paginação/erro parcial).
let directory
let mount

const STUBS = {
  advertisingService: `
    export const getAdvertisingCampaigns = (accountId, after = null) => globalThis.__aqAds(after)
    export const reviewAdvertisingCampaign = async () => {}
    export const getCommercialPromotions = (after = null) => globalThis.__aqBoosts(after)
    export const reviewCommercialPromotion = async () => {}
  `,
  storefrontService: `
    export const listStorefronts = (admin, before = null) => globalThis.__aqStorefronts(before)
    export const setStorefrontEditorial = async () => {}
    export const loadStorefrontImage = async () => new Blob()
  `,
  evocashPricingService: `export const reauthenticatePricingAdmin = async () => {}`,
  AuthCaptcha: `import { forwardRef } from 'react'
    export const AuthCaptcha = forwardRef(function AuthCaptcha(_props, ref) { return null })`,
  StorefrontImage: `export default function StorefrontImage() { return null }`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'approvals-queue-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import ApprovalsQueue from './ApprovalsQueue.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : (n.children || []).map(textOf).join(''))
        export function mountPage() {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(ApprovalsQueue))))
          })
          const root = renderer.root
          return {
            text: () => textOf(renderer.toJSON()),
            clickButton: (label) => {
              const item = root.findAll((n) => n.type === 'button' && textOf(n).trim() === label)[0]
              act(() => item.props.onClick())
            },
            countButtons: (label) =>
              root.findAll((n) => n.type === 'button' && textOf(n).trim() === label).length,
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

function ad(n, state = 'submitted') {
  return {
    ad_id: 'ad-' + n,
    title: 'Anúncio ' + n,
    partner_name: 'Marca',
    state,
    moderation_state: state,
  }
}
function boost(n, state = 'submitted') {
  return {
    id: 'boost-' + n,
    target_type: 'post',
    title: 'Impulsionamento ' + n,
    moderation_state: state,
    cash_amount: 5,
    duration_days: 1,
  }
}

test('"Carregar mais" aparece quando uma página veio cheia e some quando acaba', async () => {
  globalThis.__aqAds = (after) =>
    Promise.resolve(after ? [] : Array.from({ length: 20 }, (_, i) => ad(i)))
  globalThis.__aqStorefronts = () => Promise.resolve({ items: [], nextCursor: null })
  globalThis.__aqBoosts = () => Promise.resolve([])
  const page = mount()
  await tick()
  assert.equal(
    page.countButtons('Carregar mais'),
    1,
    'página cheia de anúncios sugere que pode haver mais'
  )
  page.clickButton('Carregar mais')
  await tick()
  assert.equal(
    page.countButtons('Carregar mais'),
    0,
    'segunda página veio vazia -- não há mais nada a carregar'
  )
  page.unmount()
})

test('"Carregar mais" busca a próxima página de cada fonte que ainda tem mais, com o cursor certo', async () => {
  const adsRequests = []
  globalThis.__aqAds = (after) => {
    adsRequests.push(after)
    if (after === null) return Promise.resolve(Array.from({ length: 20 }, (_, i) => ad(i)))
    return Promise.resolve([ad(20)])
  }
  globalThis.__aqStorefronts = () => Promise.resolve({ items: [], nextCursor: null })
  globalThis.__aqBoosts = () => Promise.resolve([])
  const page = mount()
  await tick()
  assert.match(page.text(), /Anúncio 0/)
  assert.doesNotMatch(page.text(), /Anúncio 20/)
  page.clickButton('Carregar mais')
  await tick()
  assert.match(
    page.text(),
    /Anúncio 0/,
    'itens da primeira página continuam na lista (acumula, não substitui)'
  )
  assert.match(page.text(), /Anúncio 20/, 'item da segunda página foi anexado')
  assert.deepEqual(
    adsRequests,
    [null, 'ad-19'],
    'segunda chamada usa o cursor da última linha da primeira página'
  )
  page.unmount()
})

test('erro parcial nunca mostra "nenhuma solicitação": aparece o aviso nomeando a categoria', async () => {
  globalThis.__aqAds = () => Promise.reject(new Error('boom'))
  globalThis.__aqStorefronts = () => Promise.resolve({ items: [], nextCursor: null })
  globalThis.__aqBoosts = () => Promise.resolve([])
  const page = mount()
  await tick()
  assert.doesNotMatch(page.text(), /Nenhuma solicitação nesta visão/)
  assert.match(page.text(), /Não foi possível consultar: anúncios/)
  page.unmount()
})

test('sem erro e sem itens, o blankslate legítimo continua aparecendo', async () => {
  globalThis.__aqAds = () => Promise.resolve([])
  globalThis.__aqStorefronts = () => Promise.resolve({ items: [], nextCursor: null })
  globalThis.__aqBoosts = () => Promise.resolve([])
  const page = mount()
  await tick()
  assert.match(page.text(), /Nenhuma solicitação nesta visão/)
  page.unmount()
})

test('duas categorias com erro são nomeadas juntas, não só a primeira', async () => {
  globalThis.__aqAds = () => Promise.reject(new Error('boom'))
  globalThis.__aqStorefronts = () => Promise.reject(new Error('boom'))
  globalThis.__aqBoosts = () => Promise.resolve([])
  const page = mount()
  await tick()
  assert.match(page.text(), /Não foi possível consultar: anúncios, vitrines/)
  page.unmount()
})

test('falha ao carregar mais mostra aviso específico sem derrubar os itens já carregados', async () => {
  let adsCall = 0
  globalThis.__aqAds = () => {
    adsCall++
    if (adsCall === 1) return Promise.resolve(Array.from({ length: 20 }, (_, i) => ad(i)))
    return Promise.reject(new Error('boom'))
  }
  globalThis.__aqStorefronts = () => Promise.resolve({ items: [], nextCursor: null })
  globalThis.__aqBoosts = () => Promise.resolve([])
  const page = mount()
  await tick()
  page.clickButton('Carregar mais')
  await tick()
  assert.match(page.text(), /Não foi possível carregar mais itens/)
  assert.match(page.text(), /Anúncio 0/, 'itens já carregados continuam visíveis após a falha')
  page.unmount()
})

test('impulsionamentos paginam de forma independente dos anúncios', async () => {
  globalThis.__aqAds = () => Promise.resolve([])
  globalThis.__aqStorefronts = () => Promise.resolve({ items: [], nextCursor: null })
  const boostsRequests = []
  globalThis.__aqBoosts = (after) => {
    boostsRequests.push(after)
    if (after === null) return Promise.resolve(Array.from({ length: 20 }, (_, i) => boost(i)))
    return Promise.resolve([])
  }
  const page = mount()
  await tick()
  assert.equal(page.countButtons('Carregar mais'), 1)
  page.clickButton('Carregar mais')
  await tick()
  assert.deepEqual(boostsRequests, [null, 'boost-19'])
  assert.equal(page.countButtons('Carregar mais'), 0)
  page.unmount()
})

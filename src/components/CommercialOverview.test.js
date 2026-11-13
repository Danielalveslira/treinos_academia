import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// PR2: os quatro cartões de "Início" precisam mostrar o total real de pendências
// (RPC admin_commercial_pending_counts), nunca derivar "0 pendências" só porque a
// amostra recente (até 20/10/20 linhas) veio vazia.
let directory
let mount

const STUBS = {
  advertisingService: `export const getAdvertisingCampaigns = () => globalThis.__coAds()`,
  storefrontService: `export const listStorefronts = () => globalThis.__coStorefronts()`,
  refundService: `export const listRefundRequests = () => globalThis.__coRefunds()`,
  commercialOverviewService: `export const getCommercialPendingCounts = () => globalThis.__coCounts()`,
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

test('mostra o total real de pendências mesmo quando a amostra recente vem vazia', async () => {
  // Amostra de 0 anúncios "submitted" na janela recente, mas 7 pendentes de verdade
  // (fora da janela) -- é exatamente o bug que a contagem real corrige.
  globalThis.__coAds = () =>
    Promise.resolve([
      { ad_id: 'a1', title: 'Aprovado', state: 'approved', placement_delivery_active: true },
    ])
  globalThis.__coStorefronts = () => Promise.resolve({ items: [] })
  globalThis.__coRefunds = () => Promise.resolve([])
  globalThis.__coCounts = () =>
    Promise.resolve({ pendingAds: 7, pendingStorefronts: 0, pendingBoosts: 0, openRefunds: 0 })
  const page = mount()
  await tick()
  assert.match(page.text(), /7 pendentes/)
  assert.doesNotMatch(
    page.text(),
    /Nenhum anúncio pendente\./,
    'nunca afirma "nenhum pendente" quando a contagem real diz que há 7'
  )
  assert.match(page.text(), /7 pendentes não aparecem nos registros recentes/)
  page.unmount()
})

test('contagem real zero mostra "nenhum pendente" com confiança', async () => {
  globalThis.__coAds = () => Promise.resolve([])
  globalThis.__coStorefronts = () => Promise.resolve({ items: [] })
  globalThis.__coRefunds = () => Promise.resolve([])
  globalThis.__coCounts = () =>
    Promise.resolve({ pendingAds: 0, pendingStorefronts: 0, pendingBoosts: 0, openRefunds: 0 })
  const page = mount()
  await tick()
  assert.match(page.text(), /Nenhum anúncio pendente\./)
  assert.match(page.text(), /Nenhuma vitrine pendente\./)
  assert.match(page.text(), /Nenhum reembolso em andamento\./)
  page.unmount()
})

test('falha da contagem real não esconde a amostra nem finge pendência zero', async () => {
  globalThis.__coAds = () =>
    Promise.resolve([{ ad_id: 'a1', title: 'Pendente de verdade', state: 'submitted' }])
  globalThis.__coStorefronts = () => Promise.resolve({ items: [] })
  globalThis.__coRefunds = () => Promise.resolve([])
  globalThis.__coCounts = () => Promise.reject(new Error('boom'))
  const page = mount()
  await tick()
  assert.match(
    page.text(),
    /Pendente de verdade/,
    'a amostra continua aparecendo mesmo sem a contagem real'
  )
  assert.match(page.text(), /Não foi possível confirmar o total real de pendências/)
  assert.doesNotMatch(page.text(), /0 pendentes/)
  page.unmount()
})

test('contagem real e amostra de uma fonte falham de forma independente', async () => {
  globalThis.__coAds = () => Promise.reject(new Error('boom'))
  globalThis.__coStorefronts = () => Promise.resolve({ items: [] })
  globalThis.__coRefunds = () => Promise.resolve([])
  globalThis.__coCounts = () =>
    Promise.resolve({ pendingAds: 2, pendingStorefronts: 0, pendingBoosts: 0, openRefunds: 0 })
  const page = mount()
  await tick()
  assert.match(
    page.text(),
    /Não foi possível consultar estes dados\./,
    'amostra de anúncios falhou'
  )
  assert.match(page.text(), /2 pendentes/, 'mas a contagem real (fonte independente) ainda aparece')
  assert.match(
    page.text(),
    /Nenhuma vitrine pendente\./,
    'vitrines não é afetado pela falha de anúncios'
  )
  page.unmount()
})

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Proves the invariant the UX restructure's "Resultados" split depends on: AdMetricsTab /
// list_advertiser_campaigns must never be requested on the default "Meus anúncios" load,
// only once the advertiser opens that tab (or deep-links straight into it). Everything
// below "Meus anúncios" itself (the card list, the wizard) is stubbed here and covered by
// its own tests instead (advertisingStatus.test.js, advertisingService.test.js).
let directory
let mount

const STUBS = {
  'use-auth': `export function useAuth() { return { user: { uid: 'advertiser-1' } } }`,
  'advertising-service': `export async function createAdvertisingAccount() { return 'acc-1' }`,
  'advertisers-api': `export async function readCatalog(name) {
    if (name === 'list_advertiser_accounts')
      return [{ id: 'acc-1', name: 'Minha conta', active: true, can_manage: true }]
    globalThis.__resultsRpcCalls = (globalThis.__resultsRpcCalls || 0) + 1
    return []
  }`,
  'advertising-central': `import { useEffect, createElement } from 'react'
    export default function AdvertisingCentralStub() {
      useEffect(() => { globalThis.__campaignsMounts = (globalThis.__campaignsMounts || 0) + 1 }, [])
      return createElement('div', { 'data-testid': 'campaigns-tab' }, 'CAMPAIGNS_TAB_MARKER')
    }`,
  'ad-results-panel': `import { useEffect, createElement } from 'react'
    export default function AdResultsPanelStub() {
      useEffect(() => { globalThis.__resultsMounts = (globalThis.__resultsMounts || 0) + 1 }, [])
      return createElement('div', { 'data-testid': 'results-tab' }, 'RESULTS_TAB_MARKER')
    }`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'my-ads-page-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import MyAds from './MyAds.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : (n.children || []).map(textOf).join(''))
        export function mountPage(path) {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          globalThis.__resultsRpcCalls = 0
          globalThis.__campaignsMounts = 0
          globalThis.__resultsMounts = 0
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(React.Suspense, { fallback: 'carregando' }, React.createElement(MyAds))))))
          })
          const root = renderer.root
          return {
            text: () => textOf(renderer.toJSON()),
            selectTab: (label) => {
              const item = root.findAll((n) => typeof n.props.onSelect === 'function' && textOf(n).includes(label))[0]
              act(() => item.props.onSelect({ preventDefault() {} }))
            },
            resultsRpcCalls: () => globalThis.__resultsRpcCalls,
            campaignsMounts: () => globalThis.__campaignsMounts,
            resultsMounts: () => globalThis.__resultsMounts,
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
        name: 'my-ads-test-stubs',
        setup(b) {
          b.onResolve({ filter: /hooks\/useAuth$/ }, () => ({ path: 'use-auth', namespace: 'stub' }))
          b.onResolve({ filter: /services\/advertisingService$/ }, () => ({
            path: 'advertising-service',
            namespace: 'stub',
          }))
          b.onResolve({ filter: /advertisers\.api$/ }, () => ({ path: 'advertisers-api', namespace: 'stub' }))
          b.onResolve({ filter: /components\/AdvertisingCentral$/ }, () => ({
            path: 'advertising-central',
            namespace: 'stub',
          }))
          b.onResolve({ filter: /AdResultsPanel$/ }, () => ({
            path: 'ad-results-panel',
            namespace: 'stub',
          }))
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
async function waitForText(page, marker) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (page.text().includes(marker)) return
    await tick()
  }
  assert.match(page.text(), new RegExp(marker))
}
async function waitForMount(page, readCount) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (readCount() === 1) return
    await tick()
  }
  assert.equal(readCount(), 1)
}

test('default load shows Meus anúncios and never requests Resultados data', async () => {
  const page = mount('/meus-anuncios')
  await waitForText(page, 'CAMPAIGNS_TAB_MARKER')
  await waitForMount(page, page.campaignsMounts)
  assert.match(page.text(), /CAMPAIGNS_TAB_MARKER/)
  assert.doesNotMatch(page.text(), /RESULTS_TAB_MARKER/)
  assert.equal(page.campaignsMounts(), 1)
  assert.equal(page.resultsMounts(), 0, 'Resultados module must never be mounted up front')
  assert.equal(page.resultsRpcCalls(), 0, 'list_advertiser_campaigns must never be requested up front')
  page.unmount()
})

test('opening Resultados mounts it once and never remounts Campanhas data on return', async () => {
  const page = mount('/meus-anuncios')
  await waitForText(page, 'CAMPAIGNS_TAB_MARKER')
  await waitForMount(page, page.campaignsMounts)
  page.selectTab('Resultados')
  await tick()
  assert.match(page.text(), /RESULTS_TAB_MARKER/)
  assert.equal(page.resultsMounts(), 1)
  page.selectTab('Meus anúncios')
  await tick()
  assert.equal(page.campaignsMounts(), 1, 'returning to Campanhas never remounts it')
  page.selectTab('Resultados')
  await tick()
  assert.equal(page.resultsMounts(), 1, 'reopening Resultados never remounts or refetches it')
  page.unmount()
})

test('deep-linking straight into ?tab=results opens Resultados without a Campanhas visit first', async () => {
  const page = mount('/meus-anuncios?tab=results')
  await tick()
  assert.match(page.text(), /RESULTS_TAB_MARKER/)
  assert.equal(page.resultsMounts(), 1)
  page.unmount()
})

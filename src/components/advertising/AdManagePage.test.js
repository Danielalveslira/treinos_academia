import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Página de gerenciamento (seção 4.2 do prompt de reestruturação): cada aba só busca sua
// própria dependência quando aberta, nunca na montagem; "Resultados" delega pra fora em vez
// de duplicar métricas. As abas usam botões simples e roláveis, não UnderlineNav -- ver o
// comentário em AdManagePage.jsx sobre o overlay "More" quebrado em produção.
let directory
let mount

const STUBS = {
  advertisingService: `
    export const getAdvertisingOrders = (id, before = null) => globalThis.__ampOrders(id, before)
    export const getAdvertisingRevisions = (id) => globalThis.__ampRevisions(id)
    export const confirmAdvertisingPauseLimit = () => globalThis.__ampConfirmLimit()
    export const interruptAdvertisingCampaign = (campaign, reason, requestId) => globalThis.__ampInterrupt(campaign, reason, requestId)
    export const resumeMyAdvertisingCampaign = (campaign, requestId) => globalThis.__ampResume(campaign, requestId)
  `,
  CommercialOrderHistory: `export default function CommercialOrderHistory({ resourceId, load }) {
    globalThis.__ampOrderHistoryLoaded?.(resourceId, load)
    return <div>Histórico de pagamentos de {resourceId}</div>
  }`,
  CommercialLeasePurchase: `export default function CommercialLeasePurchase() { return <div>Contratar</div> }`,
  StorefrontImage: `export default function StorefrontImage() { return null }`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ad-manage-page-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import AdManagePage from './AdManagePage.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(textOf).join('') : (n?.children || []).map(textOf).join(''))
        export function mountPage(props) {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          global.window.navigator = global.window.navigator || { platform: '', userAgent: 'node' }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(MemoryRouter, null, React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(AdManagePage, props)))))
          })
          const root = renderer.root
          const findAllButtons = () => root.findAll((n) => n.type === 'button')
          return {
            text: () => textOf(renderer.toJSON()),
            clickButton: (label) => {
              const item = findAllButtons().find((n) => textOf(n).trim() === label || n.props['aria-label'] === label)
              act(() => item.props.onClick())
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

function liveCampaign() {
  return {
    ad_id: 'ad-1',
    version: 3,
    title: 'Campanha WHey',
    description: '',
    destination: 'https://exemplo.com.br',
    moderation_state: 'approved',
    state: 'approved',
    starts_at: '2026-01-01T00:00:00Z',
    expires_at: '2099-01-01T00:00:00Z',
    delivery_state: 'active',
    placement_delivery_active: true,
    can_pay: true,
    placements: [{ code: 'home_banner', context: '00000000-0000-0000-0000-000000000000' }],
  }
}

test('mostra a Visão geral por padrão, sem buscar pagamentos nem alterações antes de abrir essas abas', async () => {
  globalThis.__ampOrders = () => Promise.resolve([])
  globalThis.__ampRevisions = () => Promise.resolve([])
  let orderHistoryCalls = 0
  globalThis.__ampOrderHistoryLoaded = () => {
    orderHistoryCalls++
  }
  const page = mount({ campaign: liveCampaign(), onBack: () => {}, onEdit: () => {}, onChange: () => {}, onViewResults: () => {} })
  await tick()
  assert.match(page.text(), /Campanha WHey/)
  assert.equal(orderHistoryCalls, 0, 'pagamentos não carrega antes de abrir a aba')
  page.unmount()
})

test('a aba Pagamentos só busca o histórico quando aberta', async () => {
  let orderHistoryCalls = 0
  globalThis.__ampOrderHistoryLoaded = (resourceId) => {
    orderHistoryCalls++
    assert.equal(resourceId, 'ad-1')
  }
  const page = mount({ campaign: liveCampaign(), onBack: () => {}, onEdit: () => {}, onChange: () => {}, onViewResults: () => {} })
  await tick()
  page.clickButton('Pagamentos')
  await tick()
  assert.match(page.text(), /Histórico de pagamentos de ad-1/)
  assert.equal(orderHistoryCalls, 1)
  page.unmount()
})

test('a aba Alterações busca as revisões uma única vez, mesmo reabrindo a aba depois', async () => {
  let revisionCalls = 0
  globalThis.__ampRevisions = () => {
    revisionCalls++
    return Promise.resolve([{ version: 2, title: 'Campanha WHey', description: 'Texto revisado' }])
  }
  const page = mount({ campaign: liveCampaign(), onBack: () => {}, onEdit: () => {}, onChange: () => {}, onViewResults: () => {} })
  await tick()
  page.clickButton('Alterações')
  await tick()
  assert.match(page.text(), /Revisão 2: Campanha WHey/)
  assert.equal(revisionCalls, 1)
  page.clickButton('Visão geral')
  page.clickButton('Alterações')
  await tick()
  assert.equal(revisionCalls, 1, 'reabrir a aba não refaz a busca')
  page.unmount()
})

test('"Resultados" delega pra fora (onViewResults) em vez de abrir uma aba própria', async () => {
  let viewResultsCalls = 0
  const page = mount({
    campaign: liveCampaign(),
    onBack: () => {},
    onEdit: () => {},
    onChange: () => {},
    onViewResults: (c) => {
      viewResultsCalls++
      assert.equal(c.ad_id, 'ad-1')
    },
  })
  await tick()
  page.clickButton('Resultados')
  assert.equal(viewResultsCalls, 1)
  assert.doesNotMatch(page.text(), /Histórico de pagamentos/, 'clicar em Resultados não abre a aba de pagamentos')
  page.unmount()
})

test('"Voltar" chama onBack', async () => {
  let backCalls = 0
  const page = mount({
    campaign: liveCampaign(),
    onBack: () => {
      backCalls++
    },
    onEdit: () => {},
    onChange: () => {},
    onViewResults: () => {},
  })
  await tick()
  page.clickButton('Voltar para Meus anúncios')
  assert.equal(backCalls, 1)
  page.unmount()
})

test('um anúncio ativo oferece "Pausar anúncio" sem chamar a RPC só de renderizar a tela', async () => {
  // O diálogo de confirmação em si (Primer Dialog/Portal) exige DOM real para abrir --
  // mesma limitação documentada em RowActionsMenu.test.js para ActionMenu.Overlay. Este
  // teste cobre o que dá pra verificar sem jsdom: o botão existe e nada dispara sozinho.
  let interruptCalls = 0
  globalThis.__ampInterrupt = () => {
    interruptCalls++
    return Promise.resolve()
  }
  const page = mount({
    campaign: liveCampaign(),
    onBack: () => {},
    onEdit: () => {},
    onChange: () => Promise.resolve([]),
    onViewResults: () => {},
  })
  await tick()
  assert.match(page.text(), /Pausar anúncio/)
  assert.equal(interruptCalls, 0)
  page.unmount()
})

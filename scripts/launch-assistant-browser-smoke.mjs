// Browser UX harness for the PR4b launch assistant (Verificar/Configurar/Validar/Ativar).
// Same technique as commercial-central-nav-browser-smoke.mjs: esbuild bundles the real
// AdminSponsoredAds page with synthetic fixtures, served locally, driven by Playwright.
// Dialog's real DOM Portal (which react-test-renderer cannot render -- see
// LaunchAssistantPanel.test.js) works correctly here, so this is where the activation
// dialog's actual layout/overflow/keyboard behavior gets proven, not just its logic.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'launch-assistant-browser-'))

const fixture = `
const useAdminSponsoredAds = () => ({ ads: [], loading: false, error: null, refresh() {}, add: async () => {}, edit: async () => {}, remove: async () => {}, setActive: async () => {} })
const useAdminCommunities = () => ({ communities: [], hasMore: false, loadMore() {} })
const useAuth = () => ({ user: { uid: 'admin-1' } })
const useToast = () => ({ toasts: [], showToast() {} })
const useConfirmDelete = () => async () => true
import { createElement } from 'react'
function InstitutionalAdForm() { return createElement('form', null, 'Formulário de anúncio') }
function ErrorState() { return null }
function ToastFlash() { return null }
function RowActionsMenu() { return null }
function AdMetricsTab() { return createElement('div', null, 'Resultados reais') }
function AdvertiserAdmin() { return createElement('div', null, 'Anunciantes reais') }
function AdvertisingAdmin() { return createElement('div', null, 'Canais de publicidade reais') }
function CommercialAdmin() { return createElement('div', null, 'Vitrines e parceiros reais') }
function CommercialEngineAdmin() { return createElement('div', null, 'Motor comercial real') }
function ApprovalsQueue() { return createElement('div', null, 'Fila de aprovações real') }
function SupplierInfoGateAdmin() { return createElement('div', null, 'Identificação do fornecedor real') }
const getCommercialPendingCounts = () => Promise.resolve({ pendingAds: 1, pendingStorefronts: 0, pendingBoosts: 1, openRefunds: 2 })
const getLaunchVerification = () => Promise.resolve({
  supplier: { state: 'ready', value: true },
  evocash: { state: 'ready', value: { quotingEnabled: true, checkoutEnabled: true } },
  catalog: { state: 'ready', value: { items: [
    { code: 'post_boost', name: 'Impulsionar publicação', integrationReady: true, salesEnabled: false, revision: '5', currentPrice: { unitPriceCash: '7', minDays: 1, maxDays: 5 } },
    { code: 'community_boost', name: 'Impulsionar comunidade', integrationReady: false, salesEnabled: false, revision: '1', currentPrice: null },
  ] } },
  inventory: { state: 'ready', value: { placements: [
    { code: 'home_banner', name: 'Banner da Home', capacity: 10, sales_enabled: true, delivery_enabled: true, revision: 2 },
    { code: 'community_feed', name: 'Publicidade no feed', capacity: 0, sales_enabled: false, delivery_enabled: false, revision: 1 },
    { code: 'community_banner', name: 'Banner de comunidade', capacity: 8, sales_enabled: false, delivery_enabled: true, revision: 3 },
  ] } },
})
globalThis.__activateCalls = []
const activateOffering = (args) => { globalThis.__activateCalls.push(['offering', args]); return Promise.resolve({}) }
const activatePlacement = (args) => { globalThis.__activateCalls.push(['placement', args]); return Promise.resolve({}) }
const reauthenticatePricingAdmin = () => Promise.resolve()
const authCaptchaRequired = false
function takeCaptchaToken() { return null }
import { forwardRef } from 'react'
const AuthCaptcha = forwardRef(function AuthCaptcha(_props, ref) { return null })
`

await build({
  stdin: {
    contents: `import '@primer/primitives/dist/css/functional/themes/light.css';import '@primer/primitives/dist/css/functional/themes/dark.css';import './src/styles/app.css';import './src/styles/navigation.css';import {ThemeSync} from './src/components/ThemeSync.jsx';import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{ThemeProvider,BaseStyles}from'@primer/react';import AdminSponsoredAds from './src/pages/AdminSponsoredAds.jsx';createRoot(document.getElementById('root')).render(<ThemeProvider colorMode='day' dayScheme='light' nightScheme='dark'><BaseStyles><ThemeSync/><div className="app-shell"><main className="main-content"><MemoryRouter initialEntries={['/admin/parcerias']}><AdminSponsoredAds/></MemoryRouter></main></div></BaseStyles></ThemeProvider>)`,
    resolveDir: root,
    loader: 'jsx',
  },
  bundle: true,
  format: 'esm',
  outfile: join(dir, 'app.js'),
  jsx: 'automatic',
  define: { 'import.meta.env': '{}' },
  loader: { '.css': 'css' },
  plugins: [
    {
      name: 'synthetic-fixtures',
      setup(b) {
        const map = [
          [/hooks\/useAdminSponsoredAds$/, 'useAdminSponsoredAds'],
          [/hooks\/useAdminCommunities$/, 'useAdminCommunities'],
          [/hooks\/useAuth$/, 'useAuth'],
          [/hooks\/useToast$/, 'useToast'],
          [/hooks\/useConfirmDelete$/, 'useConfirmDelete'],
          [/components\/InstitutionalAdForm$/, 'InstitutionalAdForm'],
          [/components\/ErrorState$/, 'ErrorState'],
          [/components\/ToastFlash$/, 'ToastFlash'],
          [/components\/RowActionsMenu$/, 'RowActionsMenu'],
          [/features\/adMetrics\/components\/AdMetricsTab$/, 'AdMetricsTab', true],
          [/features\/adMetrics\/components\/AdvertiserAdmin$/, 'AdvertiserAdmin', true],
          [/components\/AdvertisingAdmin$/, 'AdvertisingAdmin', true],
          [/components\/CommercialAdmin$/, 'CommercialAdmin', true],
          [/components\/CommercialEngineAdmin$/, 'CommercialEngineAdmin', true],
          [/components\/ApprovalsQueue$/, 'ApprovalsQueue', true],
          [/components\/SupplierInfoGateAdmin$/, 'SupplierInfoGateAdmin', true],
          [/services\/commercialOverviewService$/, 'getCommercialPendingCounts'],
          [/services\/launchAssistantService$/, null],
          [/services\/evocashPricingService$/, 'reauthenticatePricingAdmin'],
          [/utils\/authCaptcha$/, null],
          [/(^|\/)AuthCaptcha$/, 'AuthCaptcha'],
        ]
        for (const [filter] of map)
          b.onResolve({ filter }, () => ({ path: filter.source, namespace: 'fixture' }))
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
          const [, name, isDefault] = map.find(([f]) => f.source === args.path)
          const contents =
            name === null && args.path.includes('launchAssistantService')
              ? fixture + '\nexport { getLaunchVerification, activateOffering, activatePlacement }'
              : name === null
                ? fixture + '\nexport { authCaptchaRequired, takeCaptchaToken }'
                : fixture + (isDefault ? `\nexport default ${name}` : `\nexport { ${name} }`)
          return { contents, loader: 'jsx', resolveDir: root }
        })
      },
    },
  ],
  logLevel: 'silent',
})

const server = createServer(async (req, res) => {
  res.setHeader(
    'Content-Type',
    req.url.startsWith('/app.js')
      ? 'text/javascript'
      : req.url === '/app.css'
        ? 'text/css'
        : 'text/html'
  )
  res.end(
    ['/app.js', '/app.css'].includes(req.url.split('?')[0])
      ? await readFile(join(dir, req.url.split('?')[0].slice(1)))
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>'
  )
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const WIDTHS = [320, 360, 390, 768, 1024, 1440]
let browser
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  })
  const results = []

  // 1) Fechado: nenhuma largura estoura a página; abrir mostra os requisitos reais,
  // agrupados, sem rolagem horizontal, em nenhuma das seis larguras exigidas.
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(origin + '/')
    await page.getByText('Preparar publicidade').waitFor()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      `cartão fechado sem overflow em ${width}px`
    )
    await page.getByRole('button', { name: 'Abrir assistente' }).click()
    await page.getByText('Impulsionar publicação').waitFor()
    await page.getByText('Banner da Home').waitFor()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      `painel aberto sem overflow em ${width}px`
    )
    assert.deepEqual(errors, [])
    await context.close()
    results.push({ width, passed: true })
  }

  // 2) Teclado: "Abrir assistente" é alcançável por Tab/Enter; dentro do painel, o
  // botão "Ativar" de um requisito pausado abre o diálogo real (com Portal de DOM).
  {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    const openBtn = page.getByRole('button', { name: 'Abrir assistente' })
    await openBtn.focus()
    await page.keyboard.press('Enter')
    await page.getByText('Impulsionar publicação').waitFor()
    await page.getByRole('button', { name: 'Ativar', exact: true }).first().click()
    await page.getByText('Confirme sua senha').waitFor()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      'diálogo de ativação (com Portal real) não estoura a página'
    )
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await page.getByText('Confirme sua senha').waitFor({ state: 'detached' })
    results.push({ keyboardAndDialog: true, passed: true })
  }

  // 3) Ativação completa fim a fim: senha + confirmação + clique chama a RPC de
  // verdade (aqui, o stub) com a justificativa fixa e a revisão correta, e o painel
  // reflete o novo estado (sem precisar reabrir).
  {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    await page.getByRole('button', { name: 'Abrir assistente' }).click()
    await page.getByText('Impulsionar publicação').waitFor()
    await page.getByRole('button', { name: 'Ativar', exact: true }).first().click()
    await page.getByLabel('Confirme sua senha').fill('senha-correta')
    await page.getByLabel('Confirmo a ativação desta modalidade.').check()
    await page.getByRole('button', { name: 'Confirmar ativação' }).click()
    await page.getByText('Confirme sua senha').waitFor({ state: 'detached' })
    const calls = await page.evaluate(() => globalThis.__activateCalls)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'offering')
    assert.equal(calls[0][1].code, 'post_boost')
    assert.equal(calls[0][1].revision, 5)
    assert.equal(calls[0][1].reason, 'Ativado via assistente de lançamento comercial.')
    await context.close()
    results.push({ endToEndActivation: true, passed: true })
  }

  // 4) Espaço publicitário com só contratações pausadas: só o botão correspondente
  // aparece, e a ativação preserva exibição/capacidade atuais (nunca envia o outro
  // controle como desligado).
  {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    await page.getByRole('button', { name: 'Abrir assistente' }).click()
    await page.getByText('Banner de comunidade').waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Ativar exibição' }).count(),
      0,
      'exibição já está ligada -- nenhum botão de ativá-la deve aparecer'
    )
    await page.getByRole('button', { name: 'Ativar novas contratações' }).click()
    await page.getByLabel('Confirme sua senha').fill('senha-correta')
    await page.getByLabel('Confirmo a ativação desta modalidade.').check()
    await page.getByRole('button', { name: 'Confirmar ativação' }).click()
    await page.getByText('Confirme sua senha').waitFor({ state: 'detached' })
    const calls = await page.evaluate(() => globalThis.__activateCalls)
    const placementCall = calls.find((c) => c[0] === 'placement')
    assert.equal(placementCall[1].code, 'community_banner')
    assert.equal(placementCall[1].capacity, 8, 'capacidade não é alterada pela ativação')
    assert.equal(placementCall[1].salesEnabled, true)
    assert.equal(
      placementCall[1].deliveryEnabled,
      true,
      'exibição já ligada é preservada, não desligada'
    )
    await context.close()
    results.push({ placementSeparateActivation: true, passed: true })
  }

  console.log(JSON.stringify(results))
} finally {
  if (browser) await browser.close()
  await new Promise((r) => server.close(r))
  await rm(dir, { recursive: true, force: true })
}

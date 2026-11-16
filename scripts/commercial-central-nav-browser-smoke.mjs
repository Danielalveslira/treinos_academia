// Browser UX harness for the Central Comercial 4-area navigation (PR1). Mounts the real
// AdminSponsoredAds page directly inside a bare MemoryRouter (same technique as
// ads-ux-browser-smoke.mjs / storefront-products-ux-browser-smoke.mjs): no SuperAdminRoute,
// no real Supabase session, no hCaptcha -- admin login in this environment is blocked by an
// image CAPTCHA this harness will not try to bypass, so this is how the real page's CSS/
// responsive behavior gets verified without one. All services/hooks are synthetic fixtures;
// routing/alias logic itself is covered by node:test in src/pages/AdminSponsoredAds.test.js.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'commercial-nav-browser-'))

const fixture = `
// Lista longa de propósito: o teste de rolagem/cabeçalho precisa de conteúdo alto o
// bastante pra realmente rolar antes de trocar de área.
const ADS = [
  { id: 'ad-1', title: 'Oferta institucional', partnerName: 'Marca', placements: [], expiresAt: null, deliveryStatus: 'delivering', active: true, deletable: false, commercial: false },
  ...Array.from({ length: 19 }, (_, i) => ({ id: 'ad-filler-' + i, title: 'Anúncio institucional ' + i, partnerName: 'Marca', placements: [], expiresAt: null, deliveryStatus: 'delivering', active: true, deletable: false, commercial: false })),
]
const useAdminSponsoredAds = () => ({ ads: ADS, loading: false, error: null, refresh() {}, add: async () => {}, edit: async () => {}, remove: async () => {}, setActive: async () => {} })
const useAdminCommunities = () => ({ communities: [{ id: 'c1', name: 'Comunidade de teste' }], hasMore: false, loadMore() {} })
const useAuth = () => ({ user: { uid: 'admin-1' } })
const useToast = () => ({ toasts: [], showToast() {} })
const useConfirmDelete = () => async () => true
import { createElement } from 'react'
function InstitutionalAdForm() { return createElement('form', { 'data-testid': 'ad-form' }, 'Formulário de anúncio') }
function ErrorState() { return null }
function ToastFlash() { return null }
function RowActionsMenu() { return null }
function AdMetricsTab({ userId, ads }) {
  return createElement('div', { 'data-testid': 'metrics-tab' }, 'Resultados reais / ' + ads.length + ' campanhas / ' + userId)
}
function AdvertiserAdmin() { return createElement('div', { 'data-testid': 'advertiser-admin' }, 'Anunciantes reais') }
function AdvertisingAdmin() { return createElement('div', { 'data-testid': 'advertising-admin' }, 'Canais de publicidade reais') }
function CommercialAdmin() { return createElement('div', { 'data-testid': 'commercial-admin' }, 'Vitrines e parceiros reais') }
function CommercialEngineAdmin() { return createElement('div', { 'data-testid': 'commercial-engine-admin' }, 'Motor comercial real') }
function ApprovalsQueue() { return createElement('div', { 'data-testid': 'approvals-queue' }, 'Fila de aprovações real') }
function SupplierInfoGateAdmin() { return createElement('div', { 'data-testid': 'supplier-info-gate-admin' }, 'Identificação do fornecedor real') }
// CommercialOverview (Etapa A) runs for real here, not as a trivial div fixture --
// its own 2-card summary layout is what the width/overflow assertions below cover.
const getCommercialPendingCounts = () => Promise.resolve({ pendingAds: 3, pendingStorefronts: 1, pendingBoosts: 2, openRefunds: 4 })
`

await build({
  stdin: {
    contents: `import '@primer/primitives/dist/css/functional/themes/light.css';import '@primer/primitives/dist/css/functional/themes/dark.css';import './src/styles/app.css';import './src/styles/navigation.css';import {ThemeSync} from './src/components/ThemeSync.jsx';import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{ThemeProvider,BaseStyles}from'@primer/react';import AdminSponsoredAds from './src/pages/AdminSponsoredAds.jsx';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<ThemeProvider colorMode='day' dayScheme='light' nightScheme='dark'><BaseStyles><ThemeSync/><div className="app-shell"><main className="main-content"><MemoryRouter initialEntries={[q.get('path')||'/admin/parcerias']}><AdminSponsoredAds/></MemoryRouter></main></div></BaseStyles></ThemeProvider>)`,
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
          [/services\/commercialOverviewService$/, 'getCommercialPendingCounts'],
          [/components\/ApprovalsQueue$/, 'ApprovalsQueue', true],
          [/components\/SupplierInfoGateAdmin$/, 'SupplierInfoGateAdmin', true],
        ]
        for (const [filter, name] of map) {
          b.onResolve({ filter }, () => ({ path: name, namespace: 'fixture' }))
        }
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
          const [, name, isDefault] = map.find(([, n]) => n === args.path)
          return {
            contents: fixture + (isDefault ? `\nexport default ${name}` : `\nexport { ${name} }`),
            loader: 'jsx',
            resolveDir: root,
          }
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

// UnderlineNav collapses tabs that do not fit into a "<Área> Menu" overflow button
// (Primer's own responsive behavior, unchanged by this PR -- the pre-existing
// Publicidade subnav already did this with 3 tabs; this just makes it visible with
// more tabs at narrow widths). A tab is reachable either directly or through that
// menu; both are valid, so the test follows whichever the component actually chose.
async function clickVisible(page, name) {
  const match = page.getByRole('button', { name, exact: true }).first()
  if ((await match.count()) > 0 && (await match.isVisible())) {
    await match.click()
    return true
  }
  return false
}
async function selectTab(page, label, areaLabel) {
  if (await clickVisible(page, label)) return
  // Colapsado: o botão de overflow do UnderlineNav tem `aria-expanded`, independente
  // do texto visível exato ("More"/"Menu") -- seletor estável pelo próprio contrato
  // de acessibilidade do componente, escopado à subnav da área certa.
  const toggle = page.locator(`nav[aria-label="${areaLabel}"] button[aria-expanded]`).first()
  assert.equal(
    await toggle.count(),
    1,
    `menu de overflow de "${areaLabel}" não encontrado para abrir "${label}"`
  )
  await toggle.click()
  await page.waitForTimeout(30)
  assert.ok(
    await clickVisible(page, label),
    `aba "${label}" não apareceu nem dentro do menu de overflow`
  )
}

let browser
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  })
  const results = []

  // 1) As quatro áreas, em toda largura exigida: sem overflow horizontal da página,
  // nenhum botão de área cortado, cada área abre conteúdo real no primeiro clique.
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 844 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(origin + '/')
    await page.getByText('Aprovações pendentes').waitFor()

    for (const label of ['Início', 'Aprovações', 'Publicidade', 'Financeiro'])
      await page.getByRole('button', { name: label, exact: true }).waitFor()

    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      `sem overflow horizontal da página em ${width}px`
    )

    await page.getByRole('button', { name: 'Aprovações', exact: true }).click()
    await page.getByText('Fila de aprovações real').waitFor()
    assert.equal(await page.getByText('Aprovações pendentes').count(), 0)

    await page.getByRole('button', { name: 'Publicidade', exact: true }).click()
    await page.getByText('Oferta institucional').waitFor()
    // Cada aba precisa ser alcançável -- direto ou pelo menu de overflow do
    // UnderlineNav em larguras estreitas -- e a própria subnav não pode estourar a
    // página mesmo colapsada.
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      `subnav de Publicidade não estoura a página em ${width}px`
    )

    // Vitrines e Financeiro > Motor comercial abrem direto, sem cartão "Abrir" no meio.
    await selectTab(page, 'Vitrines e parceiros', 'Publicidade')
    await page.getByText('Vitrines e parceiros reais').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Abrir', exact: true }).count(), 0)

    await selectTab(page, 'Canais', 'Publicidade')
    await page.getByText('Canais de publicidade reais').waitFor()

    await selectTab(page, 'Anunciantes', 'Publicidade')
    await page.getByText('Anunciantes reais').waitFor()

    await selectTab(page, 'Resultados', 'Publicidade')
    await page.getByText('Resultados reais').waitFor()

    await page.getByRole('button', { name: 'Financeiro', exact: true }).click()
    await page.getByText('Motor comercial real').waitFor()
    await selectTab(page, 'Avançado', 'Financeiro')
    await page.getByText('Identificação do fornecedor real').waitFor()
    assert.equal(
      await page.getByText('Motor comercial real').count(),
      0,
      'Avançado não mantém o motor comercial montado ao lado'
    )

    assert.deepEqual(errors, [])
    await page.screenshot({ path: join(tmpdir(), `commercial-nav-${width}.png`), fullPage: true })
    await context.close()
    results.push({ width, passed: true })
  }

  // 2) Cabeçalho/rolagem: trocar de área volta ao topo, mesmo depois de rolar para baixo
  // numa área com conteúdo mais longo (Publicidade).
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 700 } })
    const page = await context.newPage()
    await page.goto(origin + '/?path=' + encodeURIComponent('/admin/parcerias?area=publicidade'))
    await page.getByText('Oferta institucional').waitFor()
    await page.evaluate(() => window.scrollTo(0, 400))
    assert.ok(
      (await page.evaluate(() => window.scrollY)) > 0,
      'rolagem de teste realmente desceu a página'
    )
    await page.getByRole('button', { name: 'Financeiro', exact: true }).click()
    await page.getByText('Motor comercial real').waitFor()
    assert.equal(
      await page.evaluate(() => window.scrollY),
      0,
      'trocar de área volta ao topo da página'
    )
    await context.close()
    results.push({ scrollReset: true, passed: true })
  }

  // 3) Teclado: as quatro áreas são <button> reais, alcançáveis por Tab, e a selecionada
  // expõe aria-current="page" para leitores de tela.
  {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    await page.getByText('Aprovações pendentes').waitFor()
    const inicioBtn = page.getByRole('button', { name: 'Início', exact: true })
    assert.equal(await inicioBtn.getAttribute('aria-current'), 'page')
    const aprovacoesBtn = page.getByRole('button', { name: 'Aprovações', exact: true })
    assert.equal(await aprovacoesBtn.getAttribute('aria-current'), null)
    await aprovacoesBtn.focus()
    await page.keyboard.press('Enter')
    await page.getByText('Fila de aprovações real').waitFor()
    assert.equal(await aprovacoesBtn.getAttribute('aria-current'), 'page')
    await context.close()
    results.push({ keyboardNav: true, passed: true })
  }

  console.log(JSON.stringify(results))
} catch (error) {
  for (const context of browser?.contexts() || [])
    for (const page of context.pages()) {
      await page
        .screenshot({ path: join(tmpdir(), 'commercial-nav-failure.png'), fullPage: true })
        .catch(() => {})
      console.error(
        'BROWSER_DIAGNOSTIC',
        await page.evaluate(() => document.body.innerText).catch(() => '')
      )
    }
  throw error
} finally {
  await browser?.close()
  await new Promise((r) => server.close(r))
  await rm(dir, { recursive: true, force: true })
}

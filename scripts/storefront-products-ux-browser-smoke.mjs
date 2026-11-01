// Browser UX harness for the "Minhas vitrines" restructure (PR2): simplified owner card
// list, product form with a BRL price input, real image upload flow, and the "Meu
// negócio" navigation grouping. All storefront/commercial/media RPCs are synthetic
// fixtures; backend authorization is covered separately by pgTAP (unchanged in this PR —
// no migration was needed).
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'storefront-ux-browser-'))

const fixture = `
window.__sfCalls = []
const track = (name, args) => window.__sfCalls.push({ name, args })
let seq = 0
const store = new Map()
const limits = { maxProducts: 20, maxStorefronts: 5, revision: '1' }
const ISO = (daysFromNow) => new Date(Date.now() + daysFromNow * 86400000).toISOString()

function seed(row) {
  store.set(row.id, {
    id: row.id, name: row.name, description: row.description || 'Descrição suficientemente longa.',
    contact: row.contact || 'contato@example.invalid', logoMediaId: row.logoMediaId ?? null,
    ownerUserId: 'owner-1', revision: row.revision ?? 1, draftState: row.draftState,
    editorialState: row.editorialState, hasPublishedVersion: !!row.hasPublishedVersion,
    publishedRevision: row.hasPublishedVersion ? '1' : null, canContract: !!row.canContract,
    expiresAt: row.expiresAt ?? null, entitlementId: row.expiresAt ? 'ent-' + row.id : null,
    publicationState: row.publicationState || 'private', remainingSeconds: row.expiresAt ? '432000' : '0',
    products: row.products || [], productCount: (row.products || []).length,
    lastDecision: row.lastDecision ?? null,
  })
}
seed({ id: 'sf-draft', name: 'Rascunho inicial', draftState: 'draft', editorialState: 'draft' })
seed({ id: 'sf-submitted', name: 'Em análise agora', draftState: 'submitted', editorialState: 'submitted' })
seed({ id: 'sf-rejected', name: 'Reprovada', draftState: 'rejected', editorialState: 'rejected', lastDecision: 'Descrição muito curta' })
seed({ id: 'sf-approved-ok', name: 'Aprovada sem contrato', draftState: 'approved', editorialState: 'approved', hasPublishedVersion: true, canContract: true })
seed({ id: 'sf-approved-blocked', name: 'Aprovada com contrato bloqueado', draftState: 'approved', editorialState: 'approved', hasPublishedVersion: true, canContract: false })
seed({ id: 'sf-live', name: 'Minha Loja Publicada', draftState: 'approved', editorialState: 'approved', hasPublishedVersion: true, canContract: true, publicationState: 'active', expiresAt: ISO(5), logoMediaId: 'logo-live', products: [{ id: 'p1', name: 'Whey Protein', brand: 'Marca X', description: 'Suplemento', category: 'Suplementos', storeUrl: 'https://example.invalid/whey', mediaId: 'media-p1', priceCentavos: '4990', displayOrder: 0, archived: false }] })
seed({ id: 'sf-suspended', name: 'Suspensa', draftState: 'approved', editorialState: 'suspended', hasPublishedVersion: true, lastDecision: 'Conteúdo incompleto' })
seed({ id: 'sf-archived', name: 'Arquivada antiga', draftState: 'archived', editorialState: 'archived' })

async function listStorefronts(admin, before) {
  track('list_managed_storefronts', { admin, before })
  if (admin && new URLSearchParams(location.search).has('forbid')) throw Error('APP_ACCESS_DENIED')
  return {
    items: [...store.values()],
    nextCursor: null,
    limits: { ...limits },
    price: { salesEnabled: !new URLSearchParams(location.search).has('salesOff'), price: '7', minDays: 1, maxDays: 30 },
  }
}
async function createStorefront(name) {
  track('create_product_storefront', { name })
  const id = 'new-sf-' + ++seq
  seed({ id, name, draftState: 'draft', editorialState: 'draft' })
  return id
}
async function saveStorefront(item, form) {
  track('save_product_storefront', { id: item.id, form })
  const s = store.get(item.id)
  Object.assign(s, { name: form.name, description: form.description, contact: form.contact, logoMediaId: form.logoMediaId ?? s.logoMediaId })
  s.revision += 1
  return null
}
async function saveStorefrontProduct(item, product) {
  track('save_storefront_product', { id: item.id, product })
  const s = store.get(item.id)
  const pid = product.id || 'p-' + ++seq
  const existingIndex = s.products.findIndex((p) => p.id === pid)
  const next = { id: pid, name: product.name || '', brand: product.brand || '', description: product.description || '',
    category: product.category || '', storeUrl: product.storeUrl || '', mediaId: product.mediaId || null,
    priceCentavos: product.priceCentavos || null, displayOrder: product.displayOrder || 0, archived: false }
  if (existingIndex >= 0) s.products[existingIndex] = next
  else s.products.push(next)
  s.productCount = s.products.filter((p) => !p.archived).length
  s.revision += 1
  return pid
}
async function archiveStorefrontProduct(item, productId) {
  track('archive_storefront_product', { id: item.id, productId })
  const s = store.get(item.id)
  const p = s.products.find((p) => p.id === productId)
  if (p) p.archived = true
  s.productCount = s.products.filter((p) => !p.archived).length
}
async function setStorefrontEditorial(item, state) {
  track('set_storefront_editorial', { id: item.id, state })
  const s = store.get(item.id)
  if (state === 'submitted' && (s.description.length < 10 || s.products.filter((p) => !p.archived).length === 0))
    throw Object.assign(new Error('STOREFRONT_INCOMPLETE'), {})
  s.draftState = state
  s.editorialState = state
  if (state === 'approved') { s.hasPublishedVersion = true; s.canContract = true }
  if (state === 'suspended') s.publicationState = 'suspended'
  s.revision += 1
}
async function listStorefrontOrders(id) { track('list_storefront_orders', { id }); return [{ id: 'synthetic-order', durationDays: 7, totalCash: 49, status: 'fulfilled', periodStart: ISO(-1), periodEnd: ISO(6) }] }
async function listStorefrontProducts() { return [] }
async function setStorefrontLimits(values, revision, reason, confirm) {
  track('admin_set_storefront_limits', { values, revision, reason, confirm })
  if (!confirm || reason.length < 5) throw Error('ADMIN_CONFIRMATION_REQUIRED')
  Object.assign(limits, { maxProducts: Number(values.maxProducts), maxStorefronts: Number(values.maxStorefronts), revision: String(Number(limits.revision) + 1) })
}
async function reauthenticatePricingAdmin(password) { track('reauthenticate_pricing_admin', { ok: !!password }); if (!password) throw Error('APP_ACCESS_DENIED') }
async function uploadStorefrontImage(id, file) { track('upload_storefront_image', { id, name: file?.name }); return 'media-' + ++seq }
async function loadStorefrontImage() { return new Blob(['fake'], { type: 'image/png' }) }
async function discardStorefrontImage() {}
async function isStorefrontImageLinked(id, mediaId, { product = false } = {}) {
  const row = store.get(id)
  return product ? row?.products.some((p) => p.mediaId === mediaId) : row?.logoMediaId === mediaId
}

const useAuth = () => ({ user: { uid: 'owner-1' } })
const useWallet = () => ({ wallet: { cashBalance: '1000' }, refresh: async () => {} })
async function quoteCommercialOrder(resourceId, days) {
  track('quote_commercial_order', { resourceId, days })
  return { id: 'quote-1', durationDays: days, unitPriceCash: '7', totalCash: String(Number(days) * 7), createdAt: new Date().toISOString(), quoteExpiresAt: new Date(Date.now() + 300000).toISOString() }
}
async function confirmCommercialOrder(orderId) {
  track('confirm_commercial_order', { orderId })
  return { id: orderId }
}
`

await build({
  stdin: {
    contents: `import '@primer/primitives/dist/css/functional/themes/light.css';import '@primer/primitives/dist/css/functional/themes/dark.css';import './src/styles/app.css';import './src/styles/navigation.css';import {ThemeSync} from './src/components/ThemeSync.jsx';import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{ThemeProvider,BaseStyles}from'@primer/react';import StorefrontManager from './src/components/StorefrontManager.jsx';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<ThemeProvider colorMode={q.get('theme')==='dark'?'night':'day'} dayScheme='light' nightScheme='dark'><BaseStyles><ThemeSync/><div className="app-shell"><main className="main-content"><MemoryRouter initialEntries={['/vitrine/gerenciar']}><StorefrontManager admin={q.has('admin')}/></MemoryRouter></main></div></BaseStyles></ThemeProvider>)`,
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
        b.onResolve({ filter: /hooks\/useAuth$/ }, () => ({ path: 'fx', namespace: 'fixture-auth' }))
        b.onResolve({ filter: /hooks\/useWallet$/ }, () => ({ path: 'fx', namespace: 'fixture-wallet' }))
        b.onResolve({ filter: /services\/storefrontService(?:\.js)?$/ }, () => ({
          path: 'fx',
          namespace: 'fixture-storefront',
        }))
        b.onResolve({ filter: /services\/commercialService(?:\.js)?$/ }, () => ({
          path: 'fx',
          namespace: 'fixture-commercial',
        }))
        b.onResolve({ filter: /services\/evocashPricingService(?:\.js)?$/ }, () => ({
          path: 'fx',
          namespace: 'fixture-pricing-admin',
        }))
        b.onResolve({ filter: /\/supabase\/config(?:\.js)?$/ }, () => ({ path: 'fx', namespace: 'fixture-backend' }))
        const shared = fixture
        b.onLoad({ filter: /.*/, namespace: 'fixture-auth' }, () => ({ contents: shared + '\nexport { useAuth }', loader: 'js' }))
        b.onLoad({ filter: /.*/, namespace: 'fixture-wallet' }, () => ({ contents: shared + '\nexport { useWallet }', loader: 'js' }))
        b.onLoad({ filter: /.*/, namespace: 'fixture-storefront' }, () => ({
          contents:
            shared +
            '\nexport { listStorefronts, createStorefront, saveStorefront, saveStorefrontProduct, archiveStorefrontProduct, setStorefrontEditorial, listStorefrontOrders, listStorefrontProducts, uploadStorefrontImage, loadStorefrontImage, discardStorefrontImage, isStorefrontImageLinked, setStorefrontLimits }',
          loader: 'js',
        }))
        b.onLoad({ filter: /.*/, namespace: 'fixture-commercial' }, () => ({
          contents: shared + '\nexport { quoteCommercialOrder, confirmCommercialOrder }',
          loader: 'js',
        }))
        b.onLoad({ filter: /.*/, namespace: 'fixture-pricing-admin' }, () => ({
          contents: shared + '\nexport { reauthenticatePricingAdmin }',
          loader: 'js',
        }))
        b.onLoad({ filter: /.*/, namespace: 'fixture-backend' }, () => ({
          contents: `export const supabase={rpc:async(name)=>{throw new Error('UNEXPECTED_COMMERCIAL_RPC:'+name)}}`,
          loader: 'js',
        }))
      },
    },
  ],
  logLevel: 'silent',
})

const server = createServer(async (req, res) => {
  res.setHeader(
    'Content-Type',
    req.url === '/app.js' ? 'text/javascript' : req.url === '/app.css' ? 'text/css' : 'text/html'
  )
  res.end(
    ['/app.js', '/app.css'].includes(req.url)
      ? await readFile(join(dir, req.url.slice(1)))
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>'
  )
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const uploadPath = join(dir, 'fake-product-image.png')
await writeFile(uploadPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

let browser
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  })
  const results = []

  for (const width of [320, 390, 768, 1440])
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(origin + '/?theme=' + theme)
      await page.getByRole('button', { name: 'Criar vitrine', exact: true }).waitFor()

      for (const label of ['Rascunho', 'Em análise', 'Reprovada', 'Aprovada — aguardando contratação', 'Publicada', 'Suspensa', 'Arquivada'])
        await page.getByText(label, { exact: true }).first().waitFor()
      assert.equal(await page.getByText(/draft_state|moderation_state|STOREFRONT_[A-Z_]+/).count(), 0)

      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'no horizontal overflow at width ' + width
      )
      assert.equal(await page.evaluate(() => document.documentElement.dataset.colorMode), theme)
      await page.screenshot({ path: join(tmpdir(), `storefront-ux-${width}-${theme}.png`), fullPage: true })
      assert.deepEqual(errors, [])
      await context.close()
      results.push({ width, theme, passed: true })
    }

  // "Ver minha vitrine" on a published storefront is a real, valid public link.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    await page.getByText('Minha Loja Publicada', { exact: true }).waitFor()
    const link = page.getByRole('link', { name: 'Ver minha vitrine', exact: true })
    await link.waitFor()
    assert.equal(await link.getAttribute('href'), '/vitrine/sf-live')
    assert.equal(await link.getAttribute('target'), '_blank')
    results.push({ verMinhaVitrineIsRealLink: true, passed: true })
    await context.close()
  }
  {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } })
    const page = await context.newPage()
    await page.goto(origin + '/?salesOff=1')
    const approved = page.getByTestId('storefront-card-sf-approved-ok')
    const blocked = page.getByTestId('storefront-card-sf-approved-blocked')
    await approved.getByRole('button', { name: 'Contratações ainda indisponíveis' }).waitFor()
    assert.equal(await approved.getByRole('button', { name: 'Contratações ainda indisponíveis' }).isDisabled(), true)
    assert.equal(await blocked.getByRole('button', { name: 'Contratações ainda indisponíveis' }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Contratar publicação' }).count(), 0)
    results.push({ contractingUnavailableWhenSalesOrPermissionOff: true, passed: true })
    await context.close()
  }

  // Full flow: create storefront -> add product with BRL price + image -> submit.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    await page.getByRole('button', { name: 'Criar vitrine', exact: true }).click()
    await page.getByLabel('Nome da vitrine').fill('Loja Nova E2E')
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()
    // New storefronts are appended, so this is the freshest card; data-testid keys off the
    // fixture's own id (seq resets per fresh page load, so it is deterministically "1" here).
    const card = page.getByTestId('storefront-card-new-sf-1')
    await card.getByText('Loja Nova E2E', { exact: true }).waitFor()
    await card.getByRole('button', { name: 'Ver detalhes', exact: true }).click()
    await card.getByRole('button', { name: 'Adicionar produto', exact: true }).click()
    await page.getByLabel('Nome').fill('Creatina 300g')
    const priceInput = page.getByLabel('Preço (R$)')
    await priceInput.fill('4990')
    assert.match(
      await priceInput.inputValue(),
      /^R\$\s49,90$/,
      'typed digits fill cents first, like an ATM field'
    )
    await page.locator('input[type=file]').setInputFiles(uploadPath)
    await page.getByRole('button', { name: 'Salvar produto', exact: true }).click()
    await card.getByText('Creatina 300g', { exact: true }).waitFor()
    await card.getByText(/^R\$\s49,90$/).first().waitFor()

    await card.getByRole('button', { name: 'Enviar para aprovação', exact: true }).click()
    await card.getByText('Em análise', { exact: true }).waitFor()
    assert.equal(
      await page.evaluate(() => window.__sfCalls.some((c) => c.name === 'set_storefront_editorial' && c.args.state === 'submitted')),
      true
    )
    results.push({ createStorefrontAddProductBRLPriceImageSubmit: true, passed: true })
    await context.close()
  }

  // "Meu negócio" groups the three business routes without merging them (AccountMenu).
  {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } })
    const page = await context.newPage()
    const accountMenuApp = `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{ThemeProvider,BaseStyles}from'@primer/react';import {AccountMenu} from './src/components/AccountMenu.jsx';createRoot(document.getElementById('root')).render(<ThemeProvider><BaseStyles><MemoryRouter><AccountMenu onLogout={()=>{}} onLogoutAll={()=>{}} signingOut={false}/></MemoryRouter></BaseStyles></ThemeProvider>)`
    await build({
      stdin: { contents: accountMenuApp, resolveDir: root, loader: 'jsx' },
      bundle: true,
      format: 'esm',
      outfile: join(dir, 'menu.js'),
      jsx: 'automatic',
      define: { 'import.meta.env': '{}' },
      loader: { '.css': 'css' },
      plugins: [
        {
          name: 'menu-fixtures',
          setup(b) {
            b.onResolve({ filter: /hooks\/useAuth$/ }, () => ({ path: 'fx', namespace: 'm-auth' }))
            b.onResolve({ filter: /hooks\/useColorMode$/ }, () => ({ path: 'fx', namespace: 'm-color' }))
            b.onResolve({ filter: /hooks\/usePendingNotice$/ }, () => ({ path: 'fx', namespace: 'm-notice' }))
            b.onLoad({ filter: /.*/, namespace: 'm-auth' }, () => ({ contents: `export function useAuth(){return {isSuperAdmin:false, profile:{usageProfile:'professional'}}}` }))
            b.onLoad({ filter: /.*/, namespace: 'm-color' }, () => ({ contents: `export function useColorMode(){return {dark:false,toggleColorMode(){}}}` }))
            b.onLoad({ filter: /.*/, namespace: 'm-notice' }, () => ({ contents: `export function useLogoutNotice(){return ''}` }))
          },
        },
      ],
      logLevel: 'silent',
    })
    const menuServer = createServer(async (req, res) => {
      res.setHeader('Content-Type', req.url === '/menu.js' ? 'text/javascript' : 'text/html')
      res.end(
        req.url === '/menu.js'
          ? await readFile(join(dir, 'menu.js'))
          : '<!doctype html><div id="root"></div><script type="module" src="/menu.js"></script>'
      )
    })
    await new Promise((r) => menuServer.listen(0, '127.0.0.1', r))
    const menuOrigin = `http://127.0.0.1:${menuServer.address().port}`
    await page.goto(menuOrigin)
    await page.getByRole('button', { name: 'Menu da conta', exact: true }).click()
    await page.getByText('Meu negócio', { exact: true }).waitFor()
    // Scoped by href (not role/name): "Vitrine de produtos" is also the label of the
    // unrelated public "Explorar" link to /vitrine, so name-based lookup would be
    // ambiguous; href is the one thing that must never collide between the two.
    await page.locator('a[href="/meus-anuncios"]').waitFor()
    await page.locator('a[href="/minha-vitrine"]').waitFor()
    await page.locator('a[href="/vitrine/gerenciar"]').waitFor()
    assert.equal(await page.locator('a[href="/vitrine/gerenciar"]').textContent(), 'Vitrine de produtos')
    await new Promise((r) => menuServer.close(r))
    results.push({ meuNegocioNavigationGrouped: true, passed: true })
    await context.close()
  }

  // Administrative actions use synthetic data only; verify every operation refreshes
  // the rendered record and that a denied admin read exposes no records.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 700 } })
    const page = await context.newPage()
    await page.goto(origin + '/?admin=1&theme=dark')
    await page.getByRole('heading', { name: 'Moderação de vitrines de produtos' }).waitFor()
    await page.getByRole('button', { name: 'Em análise agora' }).click()
    // Aprovar/reprovar saíram deste painel (Central de Aprovações do PR2) -- só restou
    // suspender/retomar aqui, cada um como ação própria no menu "Mais ações" em vez de um
    // <select> de decisão com quatro opções.
    await page.getByRole('button', { name: 'Mais ações' }).click()
    await page.getByRole('menuitem', { name: 'Suspender vitrine' }).click()
    await page.getByLabel('Motivo obrigatório').fill('Suspensão sintética')
    await page.getByLabel('Confirme sua senha').fill('synthetic-password')
    await page.getByLabel('Confirmo esta alteração auditada').check()
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()
    await page.getByText('Revisão em edição: 2').waitFor()
    await page.getByRole('button', { name: 'Mais ações' }).click()
    await page.getByRole('menuitem', { name: 'Histórico de contratações' }).click()
    await page.getByText(/synthetic-order/).waitFor()

    await page.getByRole('button', { name: 'Mais ações' }).click()
    await page.getByRole('menuitem', { name: 'Retomar vitrine' }).click()
    await page.getByLabel('Motivo obrigatório').fill('Retomada sintética')
    await page.getByLabel('Confirme sua senha').fill('synthetic-password')
    await page.getByLabel('Confirmo esta alteração auditada').check()
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()
    await page.getByText('Revisão em edição: 3').waitFor()

    await page.getByRole('button', { name: 'Editar vitrine' }).click()
    await page.getByLabel('Nome comercial').fill('Vitrine administrada')
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()
    await page.getByRole('button', { name: 'Vitrine administrada' }).waitFor()

    await page.getByRole('button', { name: 'Configurar limites' }).click()
    await page.getByLabel('Produtos por vitrine').fill('21')
    await page.getByLabel('Motivo obrigatório').fill('Ajuste sintético de limites')
    await page.getByLabel('Confirme sua senha').fill('synthetic-password')
    await page.getByLabel('Confirmo esta alteração auditada').check()
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()
    await page.getByRole('button', { name: 'Configurar limites' }).click()
    assert.equal(await page.getByLabel('Produtos por vitrine').inputValue(), '21')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const calls = await page.evaluate(() => window.__sfCalls)
    for (const name of ['set_storefront_editorial', 'save_product_storefront', 'admin_set_storefront_limits', 'list_storefront_orders', 'reauthenticate_pricing_admin'])
      assert.ok(calls.some((c) => c.name === name), name)
    assert.equal(calls.filter((c) => c.name === 'set_storefront_editorial').length, 2)
    results.push({ adminModerationEditLimitsHistoryRefresh: true, passed: true })
    await context.close()
  }
  {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(origin + '/?admin=1&forbid=1')
    await page.getByRole('heading', { name: 'Moderação de vitrines de produtos' }).waitFor()
    await page.getByText('Sua sessão ou conta não está autorizada. Entre novamente.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Em análise agora' }).count(), 0)
    results.push({ adminPermissionDenied: true, passed: true })
    await context.close()
  }

  await writeFile(join(tmpdir(), 'storefront-ux-browser-results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} catch (error) {
  for (const context of browser?.contexts() || [])
    for (const page of context.pages()) {
      await page.screenshot({ path: join(tmpdir(), 'storefront-ux-failure.png'), fullPage: true }).catch(() => {})
      console.error(
        'BROWSER_DIAGNOSTIC',
        await page
          .evaluate(() => ({ text: document.body.innerText, calls: window.__sfCalls }))
          .catch(() => ({}))
      )
    }
  throw error
} finally {
  await browser?.close()
  await new Promise((r) => server.close(r))
  await rm(dir, { recursive: true, force: true })
}

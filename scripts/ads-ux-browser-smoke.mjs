// Browser UX harness for the "Meus anúncios" restructure (card list + 4-step wizard).
// All advertising/community/media RPCs are synthetic fixtures; SQL authorization and the
// consolidated status/delivery projection are tested separately with pgTAP
// (advertising_campaigns_test.sql, advertising_desired_duration_delivery_test.sql).
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'ads-ux-browser-'))

const fixture = `
window.__adsCalls = []
const track = (name, args) => window.__adsCalls.push({ name, args })
let seq = 0
const store = new Map()
window.__adsStore = store
const ACCOUNT = { id: 'A', name: 'Empresa A', active: true, can_manage: true }
const COMMUNITIES = [{ id: 'c1', name: 'Comunidade de Teste' }]
const ISO = (daysFromNow) => new Date(Date.now() + daysFromNow * 86400000).toISOString()

function seed(row) {
  store.set(row.ad_id, {
    ad_id: row.ad_id, account_id: 'A', version: row.version ?? 1, state: row.state,
    title: row.title, description: row.description || '', destination: row.destination,
    creation_request: {}, review_reason: row.review_reason ?? null,
    approved_version: row.approved_version ?? null, media_id: row.media_id ?? null,
    desired_duration_days: row.desired_duration_days ?? null,
    partner_name: 'Empresa A', offering_code: 'ad_home', moderation_state: row.moderation_state,
    starts_at: row.starts_at ?? null, expires_at: row.expires_at ?? null,
    delivery_state: row.delivery_state, remaining_seconds: row.expires_at ? 5 * 86400 : 0,
    can_pay: true, placements: row.placements || [{ code: 'home_banner', context: '00000000-0000-0000-0000-000000000000' }],
    placement_delivery_active: row.placement_delivery_active ?? null,
    advertiser_paused: row.advertiser_paused ?? false,
    pauses_available: row.pauses_available ?? null,
    pauses_used: row.pauses_used ?? null,
    pause_operation_id: row.pause_operation_id ?? 17,
    suspension_origin: row.suspension_origin ?? null,
    tariff: row.tariff || { salesEnabled: true, price: '7', minDays: 1, maxDays: 30 },
  })
}
seed({ ad_id: 'ad-draft', state: 'draft', moderation_state: 'draft', title: 'Rascunho inicial', destination: 'https://example.invalid/draft', delivery_state: 'private' })
seed({ ad_id: 'ad-submitted', state: 'submitted', moderation_state: 'draft', title: 'Em análise agora', destination: 'https://example.invalid/review', delivery_state: 'private' })
seed({ ad_id: 'ad-salesoff', state: 'approved', moderation_state: 'approved', title: 'Aprovado sem vendas', destination: 'https://example.invalid/salesoff', delivery_state: 'private', tariff: { salesEnabled: false, price: '7', minDays: 1, maxDays: 30 } })
seed({ ad_id: 'ad-approved-ok', state: 'approved', moderation_state: 'approved', title: 'Aprovado com vendas abertas', destination: 'https://example.invalid/ok', delivery_state: 'private' })
seed({ ad_id: 'ad-live', state: 'approved', moderation_state: 'approved', title: 'Whey para quem quer fazer mais!', destination: 'https://example.invalid/whey', description: 'Promoção de lançamento', media_id: 'media-live', starts_at: ISO(-2), expires_at: ISO(5), delivery_state: 'active', placement_delivery_active: true, pauses_available: 3, pauses_used: 0 })
seed({ ad_id: 'ad-paused', state: 'approved', moderation_state: 'approved', advertiser_paused: true, title: 'Pausado manualmente', destination: 'https://example.invalid/paused', starts_at: ISO(-10), expires_at: ISO(10), delivery_state: 'private', placement_delivery_active: false, pauses_available: 2, pauses_used: 1 })
seed({ ad_id: 'ad-limit', state: 'approved', moderation_state: 'approved', title: 'Anúncio no limite', destination: 'https://example.invalid/limit', starts_at: ISO(-2), expires_at: ISO(5), delivery_state: 'active', placement_delivery_active: true, pauses_available: 0, pauses_used: 3 })
seed({ ad_id: 'ad-stale', state: 'approved', moderation_state: 'approved', title: 'Anúncio em outra aba', destination: 'https://example.invalid/stale', starts_at: ISO(-2), expires_at: ISO(5), delivery_state: 'active', placement_delivery_active: true, pauses_available: 1, pauses_used: 2 })
seed({ ad_id: 'ad-rejected', state: 'rejected', moderation_state: 'draft', title: 'Reprovado', destination: 'https://example.invalid/rejected', review_reason: 'Imagem não condiz com o destino', delivery_state: 'private' })
seed({ ad_id: 'ad-archived', state: 'archived', moderation_state: 'archived', title: 'Arquivado antigo', destination: 'https://example.invalid/archived', delivery_state: 'private' })

async function createAdvertisingAccount(name) { track('create_advertising_account', { name }); return 'A' }
async function getAdvertisingCampaigns(accountId, after = null) {
  window.__adsStore = store
  track('get_advertising_campaigns', { accountId, after })
  return [...store.values()].sort((a, b) => (a.ad_id < b.ad_id ? 1 : -1)).map((row) => ({ ...row }))
}
async function getAdvertisingSalesStatus() {
  track('advertising_sales_status', {})
  return [
    { code: 'home_banner', salesEnabled: true },
    { code: 'progress_banner', salesEnabled: false },
    { code: 'community_banner', salesEnabled: true },
    { code: 'community_feed', salesEnabled: true },
  ]
}
async function createAdvertisingCampaign(accountId, values, requestId) {
  track('create_advertising_campaign', { accountId, values, requestId })
  const id = 'new-ad-' + ++seq
  seed({ ad_id: id, state: 'draft', moderation_state: 'draft', title: values.title, description: values.description, destination: values.destination, delivery_state: 'private', placements: [{ code: values.placement, context: values.communityId || '00000000-0000-0000-0000-000000000000' }] })
  return id
}
async function editAdvertisingCampaign(campaign, values, submit, desiredDays = null) {
  const d = store.get(campaign.ad_id)
  if (!d) throw Object.assign(new Error('AD_NOT_FOUND'), {})
  track('edit_advertising_campaign', { ad_id: campaign.ad_id, submit, desiredDays, media_id: values.media_id })
  d.title = values.title; d.description = values.description; d.destination = values.destination
  if (values.media_id) d.media_id = values.media_id
  d.version += 1
  d.state = submit ? 'submitted' : 'draft'
  if (desiredDays != null) d.desired_duration_days = desiredDays
  return { ...d }
}
async function interruptAdvertisingCampaign(campaign, reason, requestId) { const id = campaign.ad_id; track('interrupt_advertising_campaign', { id, reason, requestId }); const d = store.get(id); if (d) { if (d.pause_operation_id !== campaign.pause_operation_id || d.starts_at !== campaign.starts_at) throw new Error('AD_PAUSE_STALE'); if (d.pauses_available === 0) throw new Error('AD_PAUSE_LIMIT_CONFIRM_REQUIRED'); d.advertiser_paused = true; if (d.pauses_available != null) { d.pauses_available -= 1; d.pauses_used += 1 } d.delivery_state = 'private' } }
async function confirmAdvertisingPauseLimit(campaign, reason) { track('confirm_advertising_pause_limit', { id: campaign.ad_id, period: campaign.starts_at, revision: campaign.approved_version, operation: campaign.pause_operation_id, reason }); const d = store.get(campaign.ad_id); if (d.pauses_available !== 0 || d.pause_operation_id !== campaign.pause_operation_id) throw new Error('AD_PAUSE_CONFIRM_STALE'); d.moderation_state = 'suspended'; d.suspension_origin = 'pause_limit'; d.delivery_state = 'private' }
async function resumeMyAdvertisingCampaign(campaign, requestId) { const id = campaign.ad_id; track('resume_my_advertising_campaign', { id, requestId }); const d = store.get(id); if (d) { d.advertiser_paused = false; d.delivery_state = 'active' } }
async function archiveAdvertisingCampaign(id) { track('archive_advertising_campaign', { id }); const d = store.get(id); if (d) { d.moderation_state = 'archived'; d.state = 'archived' } }
async function getAdvertisingRevisions() { return [] }
async function getAdvertisingOrders() { return [] }
async function getCommunityAdvertisingPermissions(id) { return { revision: 1, post_boosts_enabled: true, community_boosts_enabled: true } }
async function configureCommunityAdvertising() { return { revision: 2, post_boosts_enabled: true, community_boosts_enabled: true } }

async function readCatalog(name) {
  if (name === 'list_advertiser_accounts') return [ACCOUNT]
  return []
}
// Never actually invoked in this script (Resultados/AdMetricsTab has its own browser
// smoke test in ad-metrics-browser-smoke.mjs); only needed so AdResultsPanel's static
// import graph resolves.
async function advertiserRpc() { return {} }
const useAuth = () => ({ user: { uid: 'advertiser-1' } })
async function listActiveCommunities() { return COMMUNITIES }
async function uploadStorefrontImage(id, file) { track('upload_storefront_image', { id, name: file?.name }); return 'media-' + ++seq }
async function loadStorefrontImage() { return new Blob(['fake'], { type: 'image/png' }) }
`

await build({
  stdin: {
    contents: `import '@primer/primitives/dist/css/functional/themes/light.css';import '@primer/primitives/dist/css/functional/themes/dark.css';import './src/styles/app.css';import './src/styles/navigation.css';import {ThemeSync} from './src/components/ThemeSync.jsx';import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{ThemeProvider,BaseStyles}from'@primer/react';import MyAds from './src/pages/MyAds.jsx';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<ThemeProvider colorMode={q.get('theme')==='dark'?'night':'day'} dayScheme='light' nightScheme='dark'><BaseStyles><ThemeSync/><div className="app-shell"><main className="main-content"><MemoryRouter initialEntries={['/meus-anuncios']}><MyAds/></MemoryRouter></main></div></BaseStyles></ThemeProvider>)`,
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
        b.onResolve({ filter: /hooks\/useAuth$/ }, () => ({
          path: 'fx',
          namespace: 'fixture-auth',
        }))
        b.onResolve({ filter: /advertisers\.api(?:\.js)?$/ }, () => ({
          path: 'fx',
          namespace: 'fixture-catalog',
        }))
        b.onResolve({ filter: /services\/advertisingService(?:\.js)?$/ }, () => ({
          path: 'fx',
          namespace: 'fixture-ads',
        }))
        b.onResolve({ filter: /services\/communitiesService(?:\.js)?$/ }, () => ({
          path: 'fx',
          namespace: 'fixture-communities',
        }))
        b.onResolve({ filter: /services\/storefrontService(?:\.js)?$/ }, () => ({
          path: 'fx',
          namespace: 'fixture-storefront',
        }))
        b.onResolve({ filter: /\/supabase\/config(?:\.js)?$/ }, () => ({
          path: 'fx',
          namespace: 'fixture-backend',
        }))
        const shared = fixture
        b.onLoad({ filter: /.*/, namespace: 'fixture-auth' }, () => ({
          contents: shared + '\nexport { useAuth }',
          loader: 'js',
        }))
        b.onLoad({ filter: /.*/, namespace: 'fixture-catalog' }, () => ({
          contents: shared + '\nexport { readCatalog, advertiserRpc }',
          loader: 'js',
        }))
        b.onLoad({ filter: /.*/, namespace: 'fixture-ads' }, () => ({
          contents:
            shared +
            '\nexport { createAdvertisingAccount, getAdvertisingCampaigns, getAdvertisingSalesStatus, createAdvertisingCampaign, editAdvertisingCampaign, interruptAdvertisingCampaign, confirmAdvertisingPauseLimit, resumeMyAdvertisingCampaign, archiveAdvertisingCampaign, getAdvertisingRevisions, getAdvertisingOrders, getCommunityAdvertisingPermissions, configureCommunityAdvertising }',
          loader: 'js',
        }))
        b.onLoad({ filter: /.*/, namespace: 'fixture-communities' }, () => ({
          contents: shared + '\nexport { listActiveCommunities }',
          loader: 'js',
        }))
        b.onLoad({ filter: /.*/, namespace: 'fixture-storefront' }, () => ({
          contents: shared + '\nexport { uploadStorefrontImage, loadStorefrontImage }',
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
const uploadPath = join(dir, 'fake-ad-image.png')
await writeFile(uploadPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

let browser
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  })
  const results = []

  for (const width of [320, 360, 390, 430, 768, 1280])
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(origin + '/?theme=' + theme)
      await page.getByRole('button', { name: 'Criar anúncio', exact: true }).waitFor()

      // Every status is translated, no internal codes/UUIDs leak to the card list.
      for (const label of [
        'Rascunho',
        'Em análise',
        'Pronto para publicar',
        'Ativo',
        'Pausado por você',
        'Precisa de correção',
        'Arquivado',
      ])
        await page.getByText(label, { exact: true }).first().waitFor()
      assert.equal(await page.getByText(/home_banner|moderation_state|AD_[A-Z_]+/).count(), 0)

      // Sales disabled never shows a misleading contracting CTA (review item 5): exactly
      // the one campaign with sales open offers it, the one with sales closed never does.
      assert.equal(
        await page.getByRole('button', { name: 'Publicar anúncio', exact: true }).count(),
        1
      )
      assert.equal(
        await page.getByRole('button', { name: 'Contratações ainda indisponíveis', exact: true }).count(),
        0
      )

      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'no horizontal overflow at width ' + width
      )
      assert.equal(await page.evaluate(() => document.documentElement.dataset.colorMode), theme)
      await page.screenshot({
        path: join(tmpdir(), `ads-ux-${width}-${theme}.png`),
        fullPage: true,
      })
      assert.deepEqual(errors, [])
      await context.close()
      results.push({ width, theme, passed: true })
    }

  // "Ver anúncio" on a live campaign must do something real: a genuine preview with the
  // actual destination link, never just a promise (review item 3).
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    await page.getByText('Whey para quem quer fazer mais!', { exact: true }).waitFor()
    // Exactly one campaign is genuinely live, so the button is unambiguous without scoping
    // to its card.
    await page.getByTestId('ad-ad-live').getByRole('button', { name: 'Ver anúncio', exact: true }).click()
    const bannerPreview = page.getByLabel('Prévia do anúncio')
    await bannerPreview.locator('.sponsored-ad-banner').waitFor()
    assert.equal(await bannerPreview.locator('.sponsored-ad-media, img').count(), 0)
    assert.equal(await bannerPreview.getByText('Promoção de lançamento').count(), 0)
    const destino = page.getByRole('link', { name: 'Abrir destino do anúncio', exact: true })
    await destino.waitFor()
    assert.equal(await destino.getAttribute('href'), 'https://example.invalid/whey')
    assert.equal(await destino.getAttribute('target'), '_blank')
    results.push({ verAnuncioOpensRealDestination: true, passed: true })
    await context.close()
  }

  // A second tab consumes the third pause after this card renders. The ordinary pause RPC
  // rejects without suspending; the card refreshes and requires a second, explicit action.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    const card = page.getByTestId('ad-ad-stale')
    await card.getByRole('button', { name: 'Pausar anúncio', exact: true }).click()
    await page.evaluate(() => { const row = window.__adsStore.get('ad-stale'); row.pauses_available = 0; row.pauses_used = 3; row.pause_operation_id = 18 })
    await page.getByRole('button', { name: 'Pausar anúncio', exact: true }).last().click()
    await card.getByText('A situação deste anúncio mudou enquanto a tela estava aberta. Atualize antes de pausar.', { exact: true }).waitFor()
    await page.getByText('Limite de pausas atingido', { exact: true }).waitFor()
    assert.equal(await card.getByText('Suspenso pelo Evolutus', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Confirmar suspensão', exact: true }).click()
    await card.getByText('Suspenso pelo Evolutus', { exact: true }).waitFor()
    results.push({ staleCounterRequiresFreshConfirmation: true, passed: true })
    await context.close()
  }

  // Opening/canceling the fourth-pause dialog never calls the RPC. Confirmation suspends
  // through the common advertiser action and offers the existing support channel.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    const card = page.getByTestId('ad-ad-limit')
    await card.getByRole('button', { name: 'Pausar anúncio', exact: true }).click()
    await page.getByText('Limite de pausas atingido', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    assert.equal(
      await page.evaluate(() => window.__adsCalls.filter((c) => c.name === 'interrupt_advertising_campaign').length),
      0
    )
    assert.equal(await page.evaluate(() => window.__adsCalls.filter((c) => c.name === 'confirm_advertising_pause_limit').length), 0)
    await card.getByRole('button', { name: 'Pausar anúncio', exact: true }).click()
    await page.getByRole('button', { name: 'Confirmar suspensão', exact: true }).click()
    await card.getByText('Suspenso pelo Evolutus', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__adsCalls.filter((c) => c.name === 'interrupt_advertising_campaign').length), 0)
    assert.equal(await page.evaluate(() => window.__adsCalls.filter((c) => c.name === 'confirm_advertising_pause_limit').length), 1)
    const support = card.getByRole('link', { name: 'Solicitar liberação' })
    assert.equal(await support.getAttribute('href'), '/atendimento?tipo=appeal')
    results.push({ fourthPauseConfirmation: true, cancelDoesNotSuspend: true, passed: true })
    await context.close()
  }

  // Banner only previews the fields it actually displays.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    await page.getByRole('button', { name: 'Criar anúncio', exact: true }).click()
    await page.getByText('Página inicial', { exact: true }).click()
    await page.getByRole('button', { name: 'Avançar', exact: true }).click()
    assert.equal(await page.getByLabel('Descrição curta').count(), 0)
    assert.equal(await page.locator('input[type=file]').count(), 0)
    await page.getByLabel('Nome e título do anúncio').fill('Título do banner')
    const preview = page.getByLabel('Prévia do anúncio')
    await preview.locator('.sponsored-ad-banner').waitFor()
    assert.equal(await preview.locator('.sponsored-ad-card, .sponsored-ad-media').count(), 0)
    await context.close()
  }

  // Full creation wizard: only sellable locations appear; the draft is
  // created before the image can be attached, duration is a stored intention only, and the
  // final submission shows the real state returned by the fixture (never an assumed one).
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    await page.getByRole('button', { name: 'Criar anúncio', exact: true }).click()
    await page.getByText('Feed da comunidade', { exact: true }).click()
    assert.equal(await page.getByText('Vários espaços do Evolutus', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Progresso', { exact: true }).count(), 0)
    await page.getByLabel('Comunidade que você administra').selectOption('c1')
    const advance1 = page.getByRole('button', { name: 'Avançar', exact: true })
    assert.equal(await advance1.isDisabled(), false, 'feed com comunidade autorizada pode avançar')
    await advance1.click()

    await page.getByLabel('Nome e título do anúncio').fill('Novo anúncio E2E')
    await page.getByLabel('Descrição curta').fill('Descrição exibida no feed')
    await page.getByLabel('Link de destino (HTTPS)').fill('https://example.invalid/novo')
    const feedPreview = page.getByLabel('Prévia do anúncio')
    await feedPreview.locator('.sponsored-ad-card').waitFor()
    assert.equal(await feedPreview.locator('.sponsored-ad-banner').count(), 0)
    await feedPreview.getByText('Descrição exibida no feed').waitFor()
    assert.equal(
      await page
        .getByText('Salve os dados para habilitar o envio de imagem.', { exact: true })
        .count(),
      1
    )
    await page.getByRole('button', { name: 'Salvar dados', exact: true }).click()
    await page
      .getByText('Salve os dados para habilitar o envio de imagem.', { exact: true })
      .waitFor({ state: 'detached' })
    await page.locator('input[type=file]').setInputFiles(uploadPath)
    await page.getByRole('button', { name: 'Avançar', exact: true }).click()

    await page.getByLabel('Por quantos dias você deseja anunciar?').fill('5')
    await page.getByRole('button', { name: 'Avançar', exact: true }).click()

    await page.getByText('Duração desejada: 5 dia(s)', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Enviar para aprovação', exact: true }).click()
    await page.getByText('Status atual: Em análise.', { exact: false }).waitFor()
    assert.equal(
      await page.evaluate(() =>
        window.__adsCalls.some(
          (c) => c.name === 'edit_advertising_campaign' && c.args.submit === true
        )
      ),
      true
    )
    await page.getByRole('button', { name: 'Voltar para Meus anúncios', exact: true }).click()
    await page.getByText('Novo anúncio E2E', { exact: true }).waitFor()
    results.push({ wizardCreationImageDurationApproval: true, passed: true })
    await context.close()
  }

  // Tab navigation: Resultados is never requested on the default load.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    await page.goto(origin + '/')
    await page.getByRole('button', { name: 'Criar anúncio', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Resultados', exact: true }).click()
    await page.waitForTimeout(50)
    await page.getByRole('button', { name: 'Meus anúncios', exact: true }).click()
    await page.getByRole('button', { name: 'Criar anúncio', exact: true }).waitFor()
    results.push({ tabNavigation: true, passed: true })
    await context.close()
  }

  await writeFile(join(tmpdir(), 'ads-ux-browser-results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} catch (error) {
  for (const context of browser?.contexts() || [])
    for (const page of context.pages()) {
      await page
        .screenshot({ path: join(tmpdir(), 'ads-ux-failure.png'), fullPage: true })
        .catch(() => {})
      console.error(
        'BROWSER_DIAGNOSTIC',
        await page
          .evaluate(() => ({ text: document.body.innerText, calls: window.__adsCalls }))
          .catch(() => ({}))
      )
    }
  throw error
} finally {
  await browser?.close()
  await new Promise((r) => server.close(r))
  await rm(dir, { recursive: true, force: true })
}

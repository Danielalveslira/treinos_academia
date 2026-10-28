import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { jwt } from '../keys.mjs'
import { advertisingContext } from './phase6-browser-context.mjs'
const a = JSON.parse(readFileSync('.finance-local/phase6-access.json'))
const base = 'http://127.0.0.1:55554',
  anon = jwt({ role: 'anon' })
async function rpc(name, args, token = a.admin.access_token) {
  const r = await fetch(base + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await r.text()
  const d = text ? JSON.parse(text) : null
  assert.equal(r.ok, true, JSON.stringify(d))
  return d
}
const login = async (email, password) => {
  const r = await fetch(base + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  assert.equal(r.ok, true)
  return r.json()
}
a.admin = await login(a.adminEmail, a.adminPassword)
a.owner = await login(a.email, a.password)
a.viewer = await login(a.viewerEmail, a.password)
writeFileSync('.finance-local/phase6-access.json', JSON.stringify(a))
const network = a.campaigns.find((c) => c.placement === 'network')
for (const c of a.campaigns.filter((c) => c.id !== network.id))
  await rpc('interrupt_advertising_campaign', {
    p_id: c.id,
    p_reason: 'Isolamento sintético para validar veiculação ao vivo',
  })
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE6_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const errors = []
try {
  const context = await advertisingContext(browser, a.viewer)
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://127.0.0.1:5173/comunidades/' + a.community)
  const banner = page
    .locator('.sponsored-ad-banner')
    .filter({ hasText: 'Campanha sintética network' })
  await banner.waitFor({ timeout: 30000 })
  await page.screenshot({
    path: 'docs/finance-restructure/phase6/evidence/live-community-before.png',
    fullPage: true,
  })
  const t = performance.now()
  await rpc('interrupt_advertising_campaign', {
    p_id: network.id,
    p_reason: 'Suspensão sintética com navegador aberto e Realtime real',
  })
  await banner.waitFor({ state: 'detached', timeout: 10000 })
  const suspensionMs = Math.round(performance.now() - t)
  assert.ok((await page.locator('body').innerText()).includes('Publicação original sintética'))
  await rpc('admin_resume_advertising_campaign', {
    p_id: network.id,
    p_revision: 2,
    p_reason: 'Retomada sintética do material aprovado',
  })
  await banner.waitFor({ timeout: 15000 })
  await page.screenshot({
    path: 'docs/finance-restructure/phase6/evidence/live-community-restored.png',
    fullPage: true,
  })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.evaluate(() => {
    window.__advertisingOperations = []
    window.addEventListener('advertising-operational', (e) => window.__advertisingOperations.push(e.detail))
  })
  execFileSync('docker', ['stop', '--time', '2', 'evolutus_phase6_realtime'], { stdio: 'ignore' })
  try {
    await page.waitForFunction(() => window.__advertisingOperations.some((e) => e.scope === 'sponsoredAds' && e.type === 'authorized'), null, { timeout: 20000 })
    await page.waitForFunction(() => window.__advertisingOperations.some((e) => e.scope === 'sponsoredAds' && e.type === 'recovery_exhausted'), null, { timeout: 35000 })
    await banner.waitFor({ state: 'detached', timeout: 10000 })
    assert.ok((await page.locator('body').innerText()).includes('Publicação original sintética'))
  } finally {
    execFileSync('docker', ['start', 'evolutus_phase6_realtime'], { stdio: 'ignore' })
  }
  await banner.waitFor({ timeout: 30000 })
  assert.deepEqual(errors, [])
  writeFileSync(
    'docs/finance-restructure/phase6/evidence/live-browser.json',
    JSON.stringify(
      {
        localOnly: true,
        officialRealtime: true,
        noMockedEvents: true,
        paidBannerRendered: true,
        paidFeedRendered: (await page.locator('.sponsored-ad-card').count()) > 0,
        suspensionWithoutReload: true,
        suspensionMs,
        resumeWithoutReload: true,
        disconnectionFailClosed: true,
        reconnectedAfterServiceRestart: true,
        boundedBackendRecovery: true,
        organicContentPreserved: true,
        errors,
      },
      null,
      2
    ) + '\n'
  )
  await context.close()
  console.log('Real browser rendered paid inventory and processed suspension/resume without reload')
} finally {
  await browser.close()
}

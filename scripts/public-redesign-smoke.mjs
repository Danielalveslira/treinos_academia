import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const paths = ['/', '/como-funciona', '/funcionalidades', '/guia-registro-treino', '/para-empresas', '/vitrine', '/profissionais']
try {
  for (const width of [320, 375, 390, 768, 1024, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block' })
    await context.route('**/rest/v1/partner_products?**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
    await context.route('**/rest/v1/rpc/public_list_professionals', (route) => route.fulfill({ contentType: 'application/json', body: '{"items":[],"nextOffset":null}' }))
    const page = await context.newPage()
    for (const theme of ['dark', 'light']) {
      await page.goto(base)
      await page.evaluate((mode) => localStorage.setItem('colorMode', mode), theme)
      for (const path of paths) {
        const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
        assert.equal(response.status(), 200, `${path} ${width}`)
        assert.equal(await page.locator('h1').count(), 1)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} ${theme} ${width} overflow`)
        assert.equal(await page.locator('link[href="/public-redesign.css"]').count(), 1)
        assert.equal(await page.locator('html').getAttribute('data-public-theme'), theme)
        assert.equal(await page.locator('script[src*="primer-"]').count(), 0)
        const noindex = path === '/vitrine' || path === '/profissionais'
        assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), noindex ? 'noindex,follow' : 'index,follow')
        await page.reload({ waitUntil: 'networkidle' })
        assert.equal(await page.locator('h1').count(), 1)
      }
    }
    await context.close()
  }
  const context = await browser.newContext({ viewport: { width: 375, height: 850 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  await page.goto(`${base}/como-funciona`)
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), '#content')
  await page.locator('#public-menu-trigger').focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('#public-menu-trigger').getAttribute('aria-expanded'), 'true')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#public-menu-trigger').getAttribute('aria-expanded'), 'false')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'public-menu-trigger')
  await page.keyboard.press('Enter')
  await page.locator('#public-menu-panel a[href="/funcionalidades"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForURL('**/funcionalidades')
  assert.equal(new URL(page.url()).pathname, '/funcionalidades')
  await page.goto(`${base}/para-empresas`)
  await page.locator('#commercial-form button').click()
  assert.ok(await page.locator('#commercial-form input:invalid').count())
  await page.goto(`${base}/vitrine`)
  await page.locator('#category').focus()
  assert.equal(await page.locator('#category').evaluate((element) => element === document.activeElement), true)
  await context.close()
  const reduced = await browser.newContext({ viewport: { width: 320, height: 850 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  await reduced.route('**/rest/v1/partner_products?**', () => {})
  const reducedPage = await reduced.newPage()
  await reducedPage.goto(`${base}/vitrine`, { waitUntil: 'domcontentloaded' })
  assert.equal(await reducedPage.locator('.catalog-skeleton').first().evaluate((element) => getComputedStyle(element).animationName), 'none')
  await reduced.close()
  console.log('PUBLIC_REDESIGN_SMOKE_OK')
} finally {
  await browser.close()
}

import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const paths = ['/', '/como-funciona', '/para-empresas', '/vitrine', '/profissionais']
try {
  for (const width of [320, 375, 390, 768, 1024, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block' })
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
  await page.locator('.public-header-trigger').focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('.public-header-trigger').getAttribute('aria-expanded'), 'true')
  await page.locator('.public-header-overlay').waitFor({ state: 'visible' })
  assert.ok(await page.locator('.public-header-overlay').evaluate((panel) => panel.getBoundingClientRect().width <= 280))
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.public-header-trigger').getAttribute('aria-expanded'), 'false')
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('public-header-trigger')), true)
  await page.keyboard.press('Enter')
  await page.mouse.click(4, 150)
  await page.locator('.public-header-overlay').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.public-header-trigger').getAttribute('aria-expanded'), 'false')
  await page.locator('.public-header-trigger').focus()
  await page.keyboard.press('Enter')
  await page.locator('.public-header-overlay a[href="/para-empresas"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForURL('**/para-empresas')
  assert.equal(new URL(page.url()).pathname, '/para-empresas')
  await page.goto(`${base}/vitrine`)
  for (const [saved, expected] of [['day', 'light'], ['night', 'dark'], ['light', 'light'], ['dark', 'dark'], ['auto', 'light']]) {
    await page.evaluate((value) => localStorage.setItem('colorMode', value), saved)
    await page.reload({ waitUntil: 'domcontentloaded' })
    assert.equal(await page.locator('html').getAttribute('data-public-theme'), expected)
  }
  await context.close()
  console.log('PUBLIC_REDESIGN_SMOKE_OK')
} finally {
  await browser.close()
}

import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:5173'
const folder = 'docs/public-ui-qa/footer-primer-2026-10-22'
mkdirSync(folder, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox'],
})

try {
  for (const width of [390, 1440]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        if (response.url().startsWith(base) && response.status() >= 400)
          errors.push(`${response.status()} ${response.url()}`)
      })
      await page.addInitScript((mode) => localStorage.setItem('colorMode', mode), theme)
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      const initial = await page.locator('footer.site-footer').evaluate((footer) => ({
        theme: document.documentElement.dataset.colorMode,
        height: footer.getBoundingClientRect().height,
        background: getComputedStyle(footer).backgroundColor,
      }))
      assert.equal(initial.theme, theme)
      await page.waitForTimeout(350)
      const late = await page.locator('footer.site-footer').evaluate((footer) => ({
        theme: document.documentElement.dataset.colorMode,
        height: footer.getBoundingClientRect().height,
        background: getComputedStyle(footer).backgroundColor,
        overflow: document.documentElement.scrollWidth - innerWidth,
      }))
      assert.deepEqual(late.theme, initial.theme)
      assert.equal(late.background, initial.background)
      assert.ok(Math.abs(late.height - initial.height) < 2, `footer layout shift: ${width}/${theme}`)
      assert.ok(late.overflow <= 1, `horizontal overflow: ${width}/${theme}`)
      assert.ok(late.height < (width === 390 ? 150 : 90), `footer too tall: ${width}/${theme}`)
      assert.equal(await page.locator('footer.site-footer').count(), 1)
      assert.equal(await page.locator('footer .footer-brand').getAttribute('href'), '/')
      assert.deepEqual(await page.locator('footer nav a').evaluateAll((links) =>
        links.map((link) => link.getAttribute('href'))),
      ['/como-funciona', '/para-empresas', '/atendimento', '/termos-de-uso', '/politica-de-privacidade'])
      await page.locator('footer.site-footer').screenshot({ path: `${folder}/footer-${width}-${theme}.png` })
      await page.locator('footer a[href="/como-funciona"]').click()
      await page.waitForURL(`${base}/como-funciona`)
      assert.equal(await page.locator('footer.site-footer').count(), 1)
      assert.deepEqual(errors, [], `${width}/${theme} network/page errors`)
      console.log(`PUBLIC_FOOTER_OK ${width} ${theme} ${Math.round(late.height)}px`)
      await page.close()
    }
  }
  const noJs = await browser.newPage({ javaScriptEnabled: false })
  await noJs.goto(base)
  assert.equal(await noJs.locator('footer.site-footer nav a').count(), 5)
  await noJs.close()
  console.log('PUBLIC_FOOTER_NO_JS_OK')
} finally {
  await browser.close()
}

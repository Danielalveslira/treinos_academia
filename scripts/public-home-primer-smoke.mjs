import { mockPublicServices } from './public-smoke-fixtures.mjs'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const folder = process.env.PUBLIC_PROOF_DIR || 'docs/public-ui-qa/home-primer-2026-10-22'
mkdirSync(folder, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox'],
})

try {
  for (const width of [320, 390, 768, 1440]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('response', (response) => {
        if (response.url().startsWith(base) && response.status() >= 400)
          errors.push(`${response.status()} ${response.url()}`)
      })
      await mockPublicServices(page)
    await page.addInitScript((mode) => localStorage.setItem('colorMode', mode), theme)
      const response = await page.goto(base, { waitUntil: 'domcontentloaded' })
      assert.equal(response.status(), 200)
      await page.locator('.home-image img').evaluate((image) => image.decode())
      const initial = await page.evaluate(() => ({
        theme: document.documentElement.dataset.colorMode,
        background: getComputedStyle(document.body).backgroundColor,
        heading: getComputedStyle(document.querySelector('h1')).color,
        hero: document.querySelector('.home-hero').getBoundingClientRect().toJSON(),
      }))
      assert.equal(initial.theme, theme)
      await page.waitForTimeout(2200)
      const late = await page.evaluate(() => ({
        theme: document.documentElement.dataset.colorMode,
        background: getComputedStyle(document.body).backgroundColor,
        heading: getComputedStyle(document.querySelector('h1')).color,
        hero: document.querySelector('.home-hero').getBoundingClientRect().toJSON(),
        overflow: document.documentElement.scrollWidth - innerWidth,
      }))
      assert.equal(late.theme, theme)
      assert.equal(late.background, initial.background)
      assert.equal(late.heading, initial.heading)
      assert.ok(Math.abs(late.hero.height - initial.hero.height) < 2, `late layout shift: ${width}/${theme}`)
      assert.ok(late.overflow <= 1, `horizontal overflow: ${width}/${theme}: ${late.overflow}`)
      assert.equal(await page.locator('main h1').count(), 1)
      assert.match(await page.locator('main h1').textContent(), /Planeje, registre e acompanhe seus treinos/)
      assert.equal(await page.locator('main picture').count(), 1)
      assert.ok(await page.locator('.home-image img').evaluate((image) => image.naturalWidth > 0))
      assert.equal(await page.locator('#public-header').isVisible(), true)
      if (width <= 960) {
        await page.locator('.public-header-trigger').click()
        assert.equal(await page.locator('.public-header-overlay').isVisible(), true)
        await page.keyboard.press('Escape')
      }
      await page.screenshot({ path: `${folder}/home-${width}-${theme}-top.png` })
      await page.screenshot({ path: `${folder}/home-${width}-${theme}-full.png`, fullPage: true })
      const primary = page.locator('main a.home-primary').first()
      assert.equal(await primary.getAttribute('data-variant'), 'primary')
      await primary.click()
      await page.waitForURL(`${base}/cadastro`)
      await page.goto(base)
      await page.locator('main a[href="/como-funciona"]').click()
      await page.waitForURL(`${base}/como-funciona`)
      assert.equal((await page.locator('h1').textContent()).trim(), 'Seu treino organizado. Sua evolução visível.')
      if (width === 390 && theme === 'light') {
        for (const [path, heading] of [
          ['/profissionais', 'Profissionais'],
          ['/vitrine', 'Vitrine'],
          ['/para-empresas', 'Para empresas'],
        ]) {
          await page.goto(base)
          await page.locator(`main a[href="${path}"]`).click()
          await page.waitForURL(`${base}${path}`)
          await page.getByRole('heading', { name: heading, exact: true }).waitFor()
          assert.equal((await page.locator('h1').textContent()).trim(), heading)
        }
        await page.goto(base)
        await page.locator('.home-final .home-primary').click()
        await page.waitForURL(`${base}/cadastro`)
      }
      assert.deepEqual(errors, [], `${width}/${theme} console/network errors`)
      await page.close()
      console.log(`HOME_PRIMER_OK ${width} ${theme}`)
    }
  }
  const noJs = await browser.newPage({ javaScriptEnabled: false })
  await noJs.goto(base)
  assert.equal(await noJs.locator('main h1').count(), 1)
  assert.equal(await noJs.locator('main h2').count(), 4)
  assert.equal(await noJs.locator('main a.home-primary').count(), 2)
  assert.equal(await noJs.locator('main picture').count(), 1)
  await noJs.close()
  console.log('HOME_PRIMER_NO_JS_OK')
} finally {
  await browser.close()
}

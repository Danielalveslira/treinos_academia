import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const folder = 'docs/public-ui-qa/header-footer-minimal-2026-10-22'
mkdirSync(folder, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox'],
})

try {
  for (const width of [320, 390, 768, 1440]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await page.addInitScript((mode) => {
        if (!sessionStorage.getItem('headerSmokeInitialized')) {
          localStorage.setItem('colorMode', mode)
          sessionStorage.setItem('headerSmokeInitialized', '1')
        }
      }, theme)
      assert.equal((await page.goto(base, { waitUntil: 'domcontentloaded' })).status(), 200)
      const themeButton = page.locator('.public-theme-trigger')
      await page.waitForFunction(() => document.querySelector('.public-theme-trigger')?.hasAttribute('aria-pressed'))
      const initial = await page.evaluate(() => ({
        mode: document.documentElement.dataset.colorMode,
        background: getComputedStyle(document.body).backgroundColor,
        headerHeight: document.querySelector('#public-header').getBoundingClientRect().height,
      }))
      assert.equal(initial.mode, theme)
      assert.equal(await page.locator('#public-header .public-header-nav').count(), 0)
      assert.equal(await page.locator('#public-header .public-header-brand').isVisible(), true)
      assert.equal(await page.locator('#public-header .public-header-signup').isVisible(), width >= 768)
      assert.equal(await page.locator('.public-header-trigger').isVisible(), true)
      assert.equal(await themeButton.isVisible(), true)
      assert.equal(await page.locator('#public-header .public-header-login').isVisible(), true)
      assert.equal(await page.locator('.public-theme-icon-sun').isVisible(), theme === 'dark')
      assert.equal(await page.locator('.public-theme-icon-moon').isVisible(), theme === 'light')
      for (const selector of ['.public-header-brand', '.public-theme-trigger', '.public-header-login', '.public-header-trigger']) {
        const box = await page.locator(`#public-header ${selector}`).boundingBox()
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `${selector} clipped at ${width}`)
      }
      await page.waitForTimeout(2200)
      const late = await page.evaluate(() => ({
        mode: document.documentElement.dataset.colorMode,
        background: getComputedStyle(document.body).backgroundColor,
        headerHeight: document.querySelector('#public-header').getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth - innerWidth,
      }))
      assert.equal(late.mode, initial.mode)
      assert.equal(late.background, initial.background)
      assert.ok(Math.abs(late.headerHeight - initial.headerHeight) < 2)
      assert.ok(late.overflow <= 1, `overflow ${width}/${theme}`)
      await page.screenshot({ path: `${folder}/home-${width}-${theme}-top.png` })
      await page.screenshot({ path: `${folder}/home-${width}-${theme}-full.png`, fullPage: true })
      const next = theme === 'dark' ? 'light' : 'dark'
      await themeButton.click()
      assert.equal(await page.evaluate(() => document.documentElement.dataset.colorMode), next)
      assert.equal(await page.evaluate(() => localStorage.getItem('colorMode')), next)
      assert.equal(await themeButton.getAttribute('aria-label'), `Ativar tema ${theme === 'dark' ? 'escuro' : 'claro'}`)
      await page.reload()
      await page.waitForFunction(() => document.querySelector('.public-theme-trigger')?.hasAttribute('aria-pressed'))
      assert.equal(await page.evaluate(() => document.documentElement.dataset.colorMode), next)
      await page.locator('.public-theme-trigger').click()
      assert.equal(await page.evaluate(() => document.documentElement.dataset.colorMode), theme)
      await page.locator('.public-header-trigger').click()
      assert.deepEqual(await page.locator('.public-header-overlay a[href]').evaluateAll((links) =>
        links.map((link) => link.getAttribute('href'))),
      ['/', '/como-funciona', '/para-empresas', '/vitrine', '/profissionais', '/login', '/cadastro'])
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('.public-header-overlay').count(), 0)
      if (width === 390 && theme === 'light') {
        await page.locator('#public-header .public-header-login').click()
        await page.waitForURL(`${base}/login`)
      }
      if (width === 1440 && theme === 'light') {
        await page.locator('#public-header .public-header-login').click()
        await page.waitForURL(`${base}/login`)
      }
      assert.deepEqual(errors, [], `${width}/${theme} browser errors`)
      await page.close()
      console.log(`PUBLIC_HEADER_MINIMAL_OK ${width} ${theme}`)
    }
  }
  const automatic = await browser.newPage({ colorScheme: 'dark' })
  await automatic.goto(base)
  assert.equal(await automatic.evaluate(() => document.documentElement.dataset.colorMode), 'dark')
  await automatic.close()
  console.log('PUBLIC_HEADER_SYSTEM_THEME_OK')
} finally {
  await browser.close()
}

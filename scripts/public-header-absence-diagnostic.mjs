import { chromium } from 'playwright-core'

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] })
try {
  for (const [name, base] of [['live', 'https://www.evolutus.com.br'], ['build', 'http://127.0.0.1:4173'], ['dev', 'http://127.0.0.1:5173']]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
    const errors = []
    const failures = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('requestfailed', request => failures.push({ url: request.url(), error: request.failure()?.errorText }))
    await page.addInitScript(() => localStorage.setItem('colorMode', 'dark'))
    const response = await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
    await page.screenshot({ path: `/tmp/evolutus-${name}-390-dark-domcontentloaded.png` })
    await page.waitForTimeout(2500)
    const result = await page.evaluate(() => {
      const root = document.getElementById('public-header-menu-root')
      const buttons = [...document.querySelectorAll('#public-header button')]
      const details = buttons.map(button => {
        const style = getComputedStyle(button)
        const box = button.getBoundingClientRect()
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return { html: button.outerHTML.slice(0, 300), display: style.display, visibility: style.visibility, opacity: style.opacity, width: box.width, height: box.height, x: box.x, y: box.y, zIndex: style.zIndex, hit: hit?.outerHTML.slice(0, 160), hitInside: button.contains(hit) }
      })
      return { rootCount: document.querySelectorAll('#public-header-menu-root').length, rootHTML: root?.innerHTML.slice(0, 350), buttonCount: buttons.length, buttons: details, legacyTriggerCount: document.querySelectorAll('.public-menu-trigger').length, headerHTML: document.getElementById('public-header')?.outerHTML.slice(0, 450), theme: document.documentElement.dataset.publicTheme, css: [...document.querySelectorAll('link[rel=stylesheet]')].map(link => link.href), menuScripts: [...document.scripts].map(script => script.src).filter(src => /menu|public/i.test(src)) }
    })
    await page.screenshot({ path: `/tmp/evolutus-${name}-390-dark-late.png` })
    console.log(name, JSON.stringify({ status: response.status(), ...result, errors, failures }, null, 2))
    if (name === 'dev') {
      await page.getByRole('button', { name: 'Menu de navegação' }).click()
      await page.locator('.public-header-overlay').waitFor()
      await page.waitForTimeout(350)
      await page.screenshot({ path: '/tmp/evolutus-dev-390-dark-open.png' })
      await page.locator('.public-header-overlay a[href="/vitrine"]').click()
      await page.waitForURL(base + '/vitrine')
      console.log('dev-navigation', JSON.stringify({ path: new URL(page.url()).pathname, buttons: await page.getByRole('button', { name: 'Menu de navegação' }).count(), overlay: await page.locator('.public-header-overlay').count() }))
    }
    await page.close()
  }
  const app = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  await app.goto('http://127.0.0.1:4173/app', { waitUntil: 'domcontentloaded' })
  try { await app.waitForURL('**/login', { timeout: 10000 }) } catch { /* Record the final route below. */ }
  console.log('app-reference', JSON.stringify({ url: app.url(), authenticatedMenuVisible: await app.locator('.account-menu-trigger').isVisible() }))
  await app.close()
} finally { await browser.close() }

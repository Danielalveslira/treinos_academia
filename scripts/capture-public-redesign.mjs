import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const statesOnly = process.argv[2] === 'after-states'
const phase = statesOnly ? 'after' : process.argv[2] || 'after'
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const paths = ['/', '/como-funciona', '/funcionalidades', '/para-empresas', '/guia-registro-treino', '/vitrine', '/profissionais']
const folder = `docs/redesign-captures/${phase}`
mkdirSync(folder, { recursive: true })
try {
  if (!statesOnly) for (const theme of ['dark', 'light']) {
    for (const width of phase === 'after' ? [320, 375, 390, 768, 1024, 1366] : [375, 1366]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
      await page.addInitScript((mode) => localStorage.setItem('colorMode', mode), theme)
      await page.route('**/rest/v1/partner_products?**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
      await page.route('**/rest/v1/rpc/public_list_professionals', (route) => route.fulfill({ contentType: 'application/json', body: '{"items":[],"nextOffset":null}' }))
      for (const path of paths) {
        await page.goto(`http://127.0.0.1:4173${path}`, { waitUntil: 'networkidle' })
        const slug = path === '/' ? 'home' : path.slice(1)
        await page.screenshot({ path: `${folder}/${slug}-${theme}-${width}.png`, fullPage: true })
        if (width <= 1100) {
          await page.locator('#public-menu-trigger').click()
          await page.screenshot({ path: `${folder}/${slug}-${theme}-${width}-menu.png` })
        }
        if (path === '/para-empresas') {
          await page.locator('#commercial-form').screenshot({ path: `${folder}/${slug}-${theme}-${width}-form.png` })
        }
        if (path === '/profissionais') {
          await page.locator('#professional-filters').screenshot({ path: `${folder}/${slug}-${theme}-${width}-filters.png` })
        }
        if (path === '/vitrine') {
          await page.locator('.filter-label').screenshot({ path: `${folder}/${slug}-${theme}-${width}-filter.png` })
        }
      }
      await page.close()
    }
  }
  if (phase === 'after') {
    const context = await browser.newContext({ viewport: { width: 375, height: 850 } })
    await context.route('**/public-config.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.EVOLUTUS_PUBLIC_CONFIG={url:"https://example.supabase.co",key:"preview-key"}' }))
    const page = await context.newPage()
    await page.route('**/rest/v1/partner_products?**', () => {})
    await page.goto('http://127.0.0.1:4173/vitrine', { waitUntil: 'domcontentloaded' })
    await page.screenshot({ path: `${folder}/vitrine-loading-375.png`, fullPage: true })
    await page.unroute('**/rest/v1/partner_products?**')
    await page.route('**/rest/v1/partner_products?**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await page.reload({ waitUntil: 'networkidle' })
    await page.screenshot({ path: `${folder}/vitrine-error-375.png`, fullPage: true })
    await context.close()
  }
} finally {
  await browser.close()
}

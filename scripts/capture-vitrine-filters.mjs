import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const stage = process.argv[2]
if (!['before', 'after'].includes(stage)) throw new Error('Use before ou after')
const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const directory = `docs/vitrine-filters/${stage}`
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true, args: ['--no-sandbox'],
})
try {
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 820 }, deviceScaleFactor: 1 })
    await page.route('**/public-config.js', (route) => route.fulfill({
      contentType: 'text/javascript', body: 'window.EVOLUTUS_PUBLIC_CONFIG={url:"https://catalog.example.com",key:"visual-test"}',
    }))
    await page.route('**/rest/v1/rpc/public_product_catalog', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
      const mode = route.request().postDataJSON()?.p_mode
      const selectedCategory = route.request().postDataJSON()?.p_category
      const row = { id: '00000000-0000-0000-0000-000000000001', name: 'Produto de exemplo', brand: 'Marca de exemplo',
        description: 'Descrição breve para verificar o layout.', category: 'Acessórios', image_url: null,
        store_url: 'https://example.com/produto', sponsored: false }
      const body = mode === 'categories' ? ['Acessórios', 'Suplementos']
        : mode === 'items' ? (selectedCategory === 'Suplementos'
          ? { totalProducts: 0, totalBrands: 0, items: [] }
          : { totalProducts: 1, totalBrands: 1, items: [row] })
          : { totalProducts: 1, totalBrands: 1, groups: [{ key: 'marca de exemplo', brand: 'Marca de exemplo', count: 1, items: [row] }] }
      return route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
    })
    await page.goto(`${base}/vitrine`)
    await page.waitForFunction(() => document.querySelector('#products')?.getAttribute('aria-busy') === 'false')
    await page.screenshot({ path: `${directory}/${width}-closed.png`, fullPage: true })
    if (stage === 'before' && [390, 1440].includes(width)) {
      await page.locator('#category').focus()
      await page.screenshot({ path: `${directory}/${width}-focus.png`, fullPage: true })
    }
    if (stage === 'after') {
      await page.locator('#category-trigger').click()
      await page.screenshot({ path: `${directory}/${width}-open.png` })
      await page.getByRole('option', { name: 'Suplementos' }).click()
      await page.waitForFunction(() => document.querySelector('#products')?.getAttribute('aria-busy') === 'false')
      await page.screenshot({ path: `${directory}/${width}-selected.png`, fullPage: true })
      if (width === 390 || width === 1440) {
        await page.evaluate(() => { document.documentElement.dataset.publicTheme = 'light' })
        await page.locator('#category-trigger').click()
        await page.screenshot({ path: `${directory}/${width}-light-open.png` })
      }
    }
    await page.close()
  }
} finally { await browser.close() }
console.log(`Capturas da Vitrine: ${directory}`)

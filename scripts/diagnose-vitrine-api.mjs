import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true, args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage()
  const responses = []
  const consoleErrors = []
  page.on('response', async (response) => {
    if (!response.url().includes('/rest/v1/rpc/public_product_catalog')) return
    const body = await response.json().catch(() => ({}))
    responses.push({ status: response.status(), code: body.code, message: body.message, hint: body.hint })
  })
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.goto(`${process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'}/vitrine`)
  await page.waitForFunction(() => !document.getElementById('catalog-status')?.textContent?.includes('Carregando'))
  console.log(JSON.stringify({ responses, consoleErrors, status: await page.locator('#catalog-status').textContent() }, null, 2))
} finally { await browser.close() }

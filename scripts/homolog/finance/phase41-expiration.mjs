// UI regression: loading more must preserve the earliest server deadline.
// Public RPC responses are mocked here; real database expiry is covered by phase41-browser.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE4_CHROMIUM ||
    '/tmp/evolutus-phase3-browser/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () =>
      document.getElementById('storefront-catalog-initial')?.remove()
    )
  })
  await page.route('**/rest/v1/rpc/public_product_catalog', async (route) => {
    const request = route.request().postDataJSON()
    if (request.p_mode === 'categories') return route.fulfill({ json: [] })
    const later = request.p_offset > 0
    const now = Date.now()
    if (request.p_offset >= 2)
      return route.fulfill({
        json: {
          serverTime: new Date(now).toISOString(),
          validUntil: null,
          groups: [],
          items: [],
          totalProducts: 2,
          totalBrands: 2,
        },
      })
    return route.fulfill({
      json: {
        serverTime: new Date(now).toISOString(),
        validUntil: new Date(now + (later ? 60000 : 5000)).toISOString(),
        totalBrands: 3,
        totalProducts: 2,
        items: [],
        groups: [
          {
            key: later ? 'later' : 'earlier',
            brand: later ? 'Later deadline' : 'Earlier deadline',
            description: 'Synthetic deadline regression',
            count: 1,
            items: [],
          },
        ],
      },
    })
  })
  await page.goto('http://127.0.0.1:5173/vitrine?regression=expiration')
  const earlier = page.getByRole('heading', { name: 'Earlier deadline', exact: true })
  await earlier.waitFor()
  await page.getByRole('button', { name: 'Carregar mais vitrines', exact: true }).click()
  await page.getByRole('heading', { name: 'Later deadline', exact: true }).waitFor()
  const finalPage = page.waitForResponse(
    (r) => r.url().endsWith('/public_product_catalog') && r.request().postDataJSON().p_offset === 2
  )
  await page.getByRole('button', { name: 'Carregar mais vitrines', exact: true }).click()
  await finalPage
  assert.ok(await earlier.isVisible(), 'appending preserves earlier items before expiry')
  await earlier.waitFor({ state: 'hidden', timeout: 8000 })
  assert.equal(await page.getByRole('heading', { name: 'Later deadline', exact: true }).count(), 0)
  writeFileSync(
    'docs/finance-restructure/phase4/evidence41/pagination-expiration.json',
    JSON.stringify({
      passed: true,
      mockedRpc: true,
      earliestDeadlinePreserved: true,
      emptyFinalPagePreservesDeadline: true,
    }) + '\n'
  )
} finally {
  await browser.close()
}

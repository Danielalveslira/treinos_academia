import { mockPublicServices } from './public-smoke-fixtures.mjs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const executablePath = process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
try {
  for (const width of [375, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } })
    await mockPublicServices(page)
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(base + '/')
    await page.evaluate(() => {
      window.publicVisitProof = Math.random()
      document.getElementById('public-header').dataset.visitProof = 'kept'
    })
    const proof = await page.evaluate(() => window.publicVisitProof)
    const documents = []
    page.on('request', (request) => { if (request.resourceType() === 'document') documents.push(request.url()) })
    for (const [path, heading] of [
      ['/como-funciona', 'Como funciona'],
      ['/para-empresas', 'Para empresas'],
      ['/vitrine', 'Vitrine'],
      ['/profissionais', 'Profissionais'],
    ]) {
      await page.locator('.public-header-trigger').click()
      await page.locator(`.public-header-overlay a[href="${path}"]`).click()
      await page.waitForURL(base + path)
      await page.locator('h1').getByText(heading, { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.publicVisitProof), proof, `window recarregou em ${path}`)
      assert.equal(await page.locator('#public-header').getAttribute('data-visit-proof'), 'kept')
      assert.equal(await page.locator('#public-header').count(), 1)
      assert.equal(await page.locator('.public-header-trigger').count(), 1)
      assert.equal(await page.locator('.public-header-trigger').isVisible(), true)
      await page.locator('.public-header-overlay').waitFor({ state: 'detached' })
      await page.locator('.public-header-trigger').click()
      assert.equal(await page.locator('.public-header-overlay a[aria-current="page"]').getAttribute('href'), path)
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `https://www.evolutus.com.br${path}`)
      assert.ok((await page.title()).includes('Evolutus'))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      assert.equal(documents.length, 0, `houve reload completo em ${path}`)
    }
    await page.goBack()
    await page.waitForURL(base + '/vitrine')
    await page.locator('h1').getByText('Vitrine', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.publicVisitProof), proof)
    await page.goForward()
    await page.waitForURL(base + '/profissionais')
    await page.locator('h1').getByText('Profissionais', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.publicVisitProof), proof)
    assert.deepEqual(pageErrors, [])
    await page.evaluate(() => { window.nativeExitProof = true })
    await page.locator('.public-header-trigger').click()
    await page.locator('.public-header-overlay a[href="/login"]').click()
    await page.waitForURL(base + '/login')
    assert.equal(await page.evaluate(() => window.nativeExitProof), undefined)
    await page.close()
  }
  const noJs = await browser.newPage({ javaScriptEnabled: false })
  await noJs.goto(base + '/')
  let nativeDocuments = 0
  noJs.on('request', (request) => { if (request.resourceType() === 'document') nativeDocuments++ })
  await noJs.locator('footer a[href="/como-funciona"]').click()
  await noJs.waitForURL(base + '/como-funciona')
  assert.equal(await noJs.locator('h1').textContent(), 'Como funciona')
  assert.equal(nativeDocuments, 1)
  await noJs.close()
  const noJsMobile = await browser.newPage({ viewport: { width: 390, height: 800 }, javaScriptEnabled: false })
  await noJsMobile.goto(base + '/')
  await noJsMobile.locator('footer a[href="/como-funciona"]').click()
  await noJsMobile.waitForURL(base + '/como-funciona')
  assert.equal(await noJsMobile.locator('h1').textContent(), 'Como funciona')
  await noJsMobile.close()
  const fallback = await browser.newPage()
  await fallback.goto(base + '/')
  await fallback.evaluate(() => { window.failedVisitProof = true })
  let aborted = false
  await fallback.route('**/como-funciona', (route) => {
    if (!aborted && route.request().resourceType() === 'fetch') {
      aborted = true
      return route.abort('failed')
    }
    return route.continue()
  })
  await fallback.locator('footer a[href="/como-funciona"]').click()
  await fallback.waitForURL(base + '/como-funciona')
  await fallback.locator('h1').getByText('Como funciona').waitFor()
  assert.ok(aborted)
  assert.equal(await fallback.evaluate(() => window.failedVisitProof), undefined)
  await fallback.close()
  console.log('PUBLIC_TURBO_SMOKE_OK')
} finally {
  await browser.close()
}

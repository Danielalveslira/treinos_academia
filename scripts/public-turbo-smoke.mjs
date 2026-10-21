import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const executablePath = process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
try {
  for (const width of [375, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.route('**/rest/v1/partner_products?**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
    await page.route('**/rest/v1/rpc/public_list_professionals', (route) => route.fulfill({ contentType: 'application/json', body: '{"items":[],"nextOffset":null}' }))
    await page.goto(base + '/')
    await page.evaluate(() => {
      window.publicVisitProof = Math.random()
      document.getElementById('public-header').dataset.visitProof = 'kept'
    })
    const proof = await page.evaluate(() => window.publicVisitProof)
    const documents = []
    page.on('request', (request) => { if (request.resourceType() === 'document') documents.push(request.url()) })
    for (const [path, heading] of [
      ['/funcionalidades', 'Explore as ferramentas de treino.'],
      ['/como-funciona', 'Como usar o Evolutus'],
      ['/para-empresas', 'Publicidade e produtos no Evolutus'],
      ['/vitrine', 'Produtos de parceiros'],
      ['/profissionais', 'Profissionais e locais para sua rotina.'],
    ]) {
      if (width < 1100) await page.locator('#public-menu-trigger').click()
      await page.locator(`${width < 1100 ? '#public-menu-panel' : '.desktop-nav'} a[href="${path}"]`).click()
      await page.waitForURL(base + path)
      await page.locator('h1').getByText(heading, { exact: true }).waitFor()
      await page.locator(`#public-header .desktop-nav a[href="${path}"][aria-current="page"]`).waitFor({ state: 'attached' })
      assert.equal(await page.evaluate(() => window.publicVisitProof), proof, `window recarregou em ${path}`)
      assert.equal(await page.locator('#public-header').getAttribute('data-visit-proof'), 'kept')
      assert.equal(await page.locator('#public-header .desktop-nav a[aria-current="page"]').getAttribute('href'), path)
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `https://www.evolutus.com.br${path}`)
      assert.ok((await page.title()).includes('Evolutus'))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      assert.equal(documents.length, 0, `houve reload completo em ${path}`)
      if (path === '/para-empresas') {
        await page.locator('#commercial-form button[type="submit"]').click()
        assert.ok(await page.locator('#commercial-form input:invalid').count() > 0)
      }
    }
    await page.goBack()
    await page.waitForURL(base + '/vitrine')
    await page.locator('#public-header .desktop-nav a[href="/vitrine"][aria-current="page"]').waitFor({ state: 'attached' })
    assert.equal(await page.evaluate(() => window.publicVisitProof), proof)
    await page.goForward()
    await page.waitForURL(base + '/profissionais')
    await page.locator('#public-header .desktop-nav a[href="/profissionais"][aria-current="page"]').waitFor({ state: 'attached' })
    assert.equal(await page.evaluate(() => window.publicVisitProof), proof)
    await page.waitForFunction(() => !document.getElementById('directory-status')?.textContent?.includes('Carregando'))
    await page.locator('#professional-filters [name="cidade"]').fill('Santos')
    await page.waitForFunction(() => location.search.includes('cidade=Santos'))
    await page.reload()
    await page.locator('#professional-filters [name="cidade"]').waitFor()
    assert.equal(await page.locator('#professional-filters [name="cidade"]').inputValue(), 'Santos')
    assert.deepEqual(pageErrors, [])
    await page.evaluate(() => { window.nativeExitProof = true })
    if (width < 1100) await page.locator('#public-menu-trigger').click()
    await page.locator(width < 1100 ? '#public-menu-panel a[href="/login"]' : '#public-header .login-link').click()
    await page.waitForURL(base + '/login')
    assert.equal(await page.evaluate(() => window.nativeExitProof), undefined)
    await page.close()
  }
  const noJs = await browser.newPage({ javaScriptEnabled: false })
  await noJs.goto(base + '/')
  let nativeDocuments = 0
  noJs.on('request', (request) => { if (request.resourceType() === 'document') nativeDocuments++ })
  await noJs.locator('.desktop-nav a[href="/funcionalidades"]').click()
  await noJs.waitForURL(base + '/funcionalidades')
  assert.equal(await noJs.locator('h1').textContent(), 'Explore as ferramentas de treino.')
  assert.equal(nativeDocuments, 1)
  await noJs.close()
  const fallback = await browser.newPage()
  await fallback.goto(base + '/')
  await fallback.evaluate(() => { window.failedVisitProof = true })
  let aborted = false
  await fallback.route('**/funcionalidades', (route) => {
    if (!aborted && route.request().resourceType() === 'fetch') {
      aborted = true
      return route.abort('failed')
    }
    return route.continue()
  })
  await fallback.locator('.desktop-nav a[href="/funcionalidades"]').click()
  await fallback.waitForURL(base + '/funcionalidades')
  await fallback.locator('h1').getByText('Explore as ferramentas de treino.').waitFor()
  assert.ok(aborted)
  assert.equal(await fallback.evaluate(() => window.failedVisitProof), undefined)
  await fallback.close()
  console.log('PUBLIC_TURBO_SMOKE_OK')
} finally {
  await browser.close()
}

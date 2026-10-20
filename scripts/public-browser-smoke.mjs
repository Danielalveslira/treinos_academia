import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const executablePath =
  process.env.CHROMIUM_PATH ||
  '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
try {
  for (const width of [390, 768, 1366, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } })
    // Route verification is independent of whether the commercial migration has been applied.
    await page.route('**/rest/v1/partner_products?**', (route) =>
      route.fulfill({ contentType: 'application/json', body: '[]' })
    )
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`)
    })
    page.on('pageerror', (error) => errors.push(error.message))
    for (const [path, heading] of [
      ['/', 'Saiba o que treinou.Veja o que mudou.'],
      ['/como-funciona', 'Como usar o Evolutus'],
      ['/funcionalidades', 'Explore as ferramentas de treino.'],
      ['/para-empresas', 'Publicidade e produtos no Evolutus'],
      ['/vitrine', 'Produtos de parceiros'],
    ]) {
      const response = await page.goto(`${base}${path}`)
      assert.equal(response.status(), 200, path)
      assert.equal((await page.locator('h1').textContent()).replace(/\s+/g, ' ').trim(), heading)
      assert.equal(await page.locator('h1').count(), 1)
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${path} transborda em ${width}px`
      )
      if (width === 390 || width === 1366)
        await page.screenshot({
          path: `/tmp/evolutus-${path === '/' ? 'home' : path.slice(1)}-${width}.png`,
          fullPage: true,
        })
      const refreshed = await page.reload()
      assert.equal(refreshed.status(), 200, `F5 em ${path}`)
      assert.equal(
        (await page.locator('h1').textContent()).replace(/\s+/g, ' ').trim(),
        heading,
        `F5 em ${path}`
      )
    }
    await page.goto(base)
    for (const [href, heading] of [
      ['/como-funciona', 'Como usar o Evolutus'],
      ['/funcionalidades', 'Explore as ferramentas de treino.'],
      ['/para-empresas', 'Publicidade e produtos no Evolutus'],
      ['/vitrine', 'Produtos de parceiros'],
    ]) {
      if (width <= 900) await page.locator('.mobile-menu summary').click()
      await page
        .locator(`${width <= 900 ? '.mobile-menu' : '.desktop-nav'} a[href="${href}"]`)
        .click()
      assert.equal(new URL(page.url()).pathname, href)
      assert.equal((await page.locator('h1').textContent()).replace(/\s+/g, ' ').trim(), heading)
      await page.locator('.site-header .brand').click()
      assert.equal(new URL(page.url()).pathname, '/')
    }
    assert.deepEqual(errors, [], `erros no console das páginas públicas em ${width}px`)
    await page.goto(`${base}/login`)
    await page.locator('.public-header .brand').click()
    assert.equal(new URL(page.url()).pathname, '/')
    assert.equal(
      (await page.locator('h1').textContent()).replace(/\s+/g, ' ').trim(),
      'Saiba o que treinou.Veja o que mudou.'
    )
    await page.goto(`${base}/para-empresas`)
    await page.locator('#commercial-form button').click()
    assert.ok((await page.locator('#commercial-form input:invalid').count()) > 0)
    if (width === 1366) {
      await page.route('**/rest/v1/rpc/submit_commercial_lead', async (route) => {
        const payload = route.request().postDataJSON()
        assert.equal(payload.p_privacy, true)
        assert.equal(payload.p_modality, 'Publicidade')
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      })
      await page.locator('[name="company"]').fill('Empresa de teste')
      await page.locator('[name="contact"]').fill('Contato de teste')
      await page.locator('[name="email"]').fill('contato@example.com')
      await page.locator('[name="segment"]').fill('Equipamentos')
      await page.locator('[name="website"]').fill('https://example.com')
      await page.locator('[name="modality"]').selectOption({ label: 'Publicidade' })
      await page
        .locator('[name="message"]')
        .fill('Proposta de teste de integração do formulário comercial.')
      await page.locator('[name="privacy"]').check()
      await page.locator('#commercial-form button').click()
      await page
        .getByText('Proposta recebida. A equipe analisará as informações enviadas.')
        .waitFor()
    }
    await page.screenshot({ path: `/tmp/evolutus-public-${width}.png`, fullPage: true })
    await page.close()
  }
  const page = await browser.newPage()
  const catalogErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error')
      catalogErrors.push(`${message.text()} ${message.location().url}`)
  })
  page.on('pageerror', (error) => catalogErrors.push(error.message))
  await page.route('**/public-config.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.EVOLUTUS_PUBLIC_CONFIG={url:"https://ywrjojrjgozdfpddkkuy.supabase.co",key:"test-anon-key"}',
    })
  )
  await page.route('**/rest/v1/partner_products?**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          name: 'Produto de teste',
          brand: 'Marca de teste',
          description: 'Descrição do teste de interface',
          category: 'Acessórios',
          image_url: null,
          store_url: 'https://example.com/produto',
          sponsored: true,
        },
      ]),
    })
  )
  await page.goto(`${base}/vitrine`)
  await page.getByText('Produto de teste').waitFor()
  const storeLink = page.getByRole('link', { name: 'Ver na loja ↗' })
  assert.equal(await storeLink.getAttribute('href'), 'https://example.com/produto')
  assert.match(await storeLink.getAttribute('rel'), /sponsored/)
  assert.match(await page.locator('#products').textContent(), /Patrocinado/)
  assert.deepEqual(catalogErrors, [], 'erros no console da vitrine')
  await page.close()
  console.log('PUBLIC_BROWSER_SMOKE_OK')
} finally {
  await browser.close()
}

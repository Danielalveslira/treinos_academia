import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const executablePath =
  process.env.CHROMIUM_PATH ||
  '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
try {
  for (const width of [320, 375, 390, 768, 1024, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } })
    // Route verification is independent of whether the commercial migration has been applied.
    await page.route('**/rest/v1/partner_products?**', (route) =>
      route.fulfill({ contentType: 'application/json', body: '[]' })
    )
    await page.route('**/rest/v1/rpc/public_product_catalog', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
      return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: route.request().postDataJSON()?.p_mode === 'categories'
          ? '[]' : '{"totalProducts":0,"totalBrands":0,"groups":[],"items":[]}' })
    })
    await page.route('**/rest/v1/rpc/public_list_professionals', (route) =>
      route.fulfill({ contentType: 'application/json', body: '{"items":[],"nextOffset":null}' })
    )
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`)
    })
    page.on('pageerror', (error) => errors.push(error.message))
    for (const [path, heading] of [
      ['/', 'Seu treino, registrado com clareza.'],
      ['/como-funciona', 'Como usar o Evolutus'],
      ['/funcionalidades', 'Explore as ferramentas de treino.'],
      ['/guia-registro-treino', 'Como registrar séries, repetições e cargas'],
      ['/para-empresas', 'Publicidade e produtos no Evolutus'],
      ['/vitrine', 'Produtos de parceiros'],
      ['/profissionais', 'Profissionais e locais para sua rotina.'],
    ]) {
      const response = await page.goto(`${base}${path}`)
      assert.equal(response.status(), 200, path)
      assert.equal((await page.locator('h1').textContent()).replace(/\s+/g, ' ').trim(), heading)
      assert.equal(await page.locator('h1').count(), 1)
      await page.locator('.official-banner img[loading="eager"]').evaluateAll(async (images) => {
        await Promise.all(images.map((img) => img.decode()))
      })
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
      ['/guia-registro-treino', 'Como registrar séries, repetições e cargas'],
      ['/para-empresas', 'Publicidade e produtos no Evolutus'],
      ['/vitrine', 'Produtos de parceiros'],
      ['/profissionais', 'Profissionais e locais para sua rotina.'],
    ]) {
      if (width <= 1100) await page.locator('#public-menu-trigger').click()
      await page
        .locator(`${width <= 1100 ? '#public-menu-panel' : '.desktop-nav'} a[href="${href}"]`)
        .click()
      await page.waitForURL(`${base}${href}`)
      await page.waitForFunction((expected) =>
        document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() === expected, heading)
      assert.equal(new URL(page.url()).pathname, href)
      assert.equal((await page.locator('h1').textContent()).replace(/\s+/g, ' ').trim(), heading)
      await page.locator('.site-header .brand').click()
      await page.waitForURL(base + '/')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Seu treino, registrado com clareza.'))
      assert.equal(new URL(page.url()).pathname, '/')
    }
    assert.deepEqual(errors, [], `erros no console das páginas públicas em ${width}px`)
    await page.goto(`${base}/login`)
    await page.locator('.public-header .brand').click()
    assert.equal(new URL(page.url()).pathname, '/')
    assert.equal(
      (await page.locator('h1').textContent()).replace(/\s+/g, ' ').trim(),
      'Seu treino, registrado com clareza.'
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
  const catalogRow = (name, sponsored) => ({
    id: '00000000-0000-0000-0000-000000000001', name, brand: 'Marca de teste',
    description: 'Descrição do teste de interface', category: 'Acessórios', image_url: null,
    store_url: `https://example.com/${name === 'Produto de teste' ? 'produto' : 'recuperado'}`, sponsored,
  })
  const catalogReply = (row) => ({ totalProducts: 1, totalBrands: 1,
    groups: [{ key: 'marca de teste', brand: 'Marca de teste', count: 1, items: [row] }] })
  await page.route('**/rest/v1/rpc/public_product_catalog', (route) => route.fulfill({
    contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(route.request().postDataJSON()?.p_mode === 'categories'
      ? ['Acessórios'] : catalogReply(catalogRow('Produto de teste', true))),
  }))
  await page.goto(`${base}/vitrine`)
  await page.getByText('Produto de teste').waitFor()
  const storeLink = page.getByRole('link', { name: 'Ver na loja ↗' })
  assert.equal(await storeLink.getAttribute('href'), 'https://example.com/produto')
  assert.match(await storeLink.getAttribute('rel'), /sponsored/)
  assert.match(await page.locator('#products').textContent(), /Patrocinado/)
  assert.deepEqual(catalogErrors, [], 'erros no console da vitrine')
  let catalogAttempts = 0
  await page.route('**/rest/v1/rpc/public_product_catalog', (route) => {
    if (route.request().postDataJSON()?.p_mode === 'categories') return route.fulfill({
      contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '["Acessórios"]',
    })
    catalogAttempts += 1
    return route.fulfill(catalogAttempts === 1
      ? { status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }
      : { contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(catalogReply(catalogRow('Produto recuperado', false))) })
  })
  await page.reload()
  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await page.getByText('Produto recuperado').waitFor()
  assert.equal(catalogAttempts, 2)
  await page.close()
  console.log('PUBLIC_BROWSER_SMOKE_OK')
} finally {
  await browser.close()
}

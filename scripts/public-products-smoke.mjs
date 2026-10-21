import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const executablePath = process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
const makeRows = (count) => Array.from({ length: count }, (_, index) => ({
  id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
  name: `Produto ${index + 1}`,
  brand: index < 7 ? 'Marca A' : `Marca ${String.fromCharCode(65 + Math.floor(index / 7))}`,
  description: 'Descrição real simulada apenas no navegador de teste.',
  category: index % 2 ? 'Acessórios' : 'Suplementos',
  image_url: index === 0 ? 'https://images.example.com/broken.webp' : null,
  store_url: 'https://loja.example.com/produto',
  sponsored: index === 0,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, count - index)).toISOString(),
}))

async function setup(page, dataset) {
  let calls = 0
  await page.route('**/public-config.js', (route) => route.fulfill({
    contentType: 'text/javascript', body: 'window.EVOLUTUS_PUBLIC_CONFIG={url:"https://catalog.example.com",key:"test"}',
  }))
  await page.route('**/rest/v1/rpc/public_product_catalog', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    calls++
    const params = route.request().postDataJSON()
    const valid = dataset.filter((row) => row.approved !== false && row.active !== false)
    const categories = [...new Set(valid.map((row) => row.category))].sort()
    let result
    if (params.p_mode === 'categories') result = categories
    else if (params.p_mode === 'groups') {
      const groups = [...Map.groupBy(valid, (row) => row.brand.toLowerCase()).entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, items]) => ({ key, brand: items[0].brand, count: items.length, items: items.slice(0, 5) }))
      result = { totalProducts: valid.length, totalBrands: groups.length, groups: groups.slice(params.p_offset, params.p_offset + params.p_limit) }
    } else {
      const filtered = valid.filter((row) =>
        (!params.p_category || row.category === params.p_category) &&
        (!params.p_brand || row.brand.toLowerCase() === params.p_brand) &&
        (!params.p_search || [row.name, row.brand, row.category].some((field) => field.toLowerCase().includes(params.p_search.toLowerCase()))))
      result = { totalProducts: filtered.length, totalBrands: new Set(filtered.map((row) => row.brand)).size,
        items: filtered.slice(params.p_offset, params.p_offset + params.p_limit) }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(result) })
  })
  await page.route('https://images.example.com/**', (route) => route.fulfill({ status: 404, body: '' }))
  return () => calls
}

try {
  for (const count of [0, 1, 6, 36, 205]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 850 } })
    const calls = await setup(page, [...makeRows(count), { ...makeRows(1)[0], id: 'hidden', approved: false }])
    await page.goto(`${base}/vitrine`)
    await page.waitForFunction(() => !document.getElementById('products').getAttribute('aria-busy')?.includes('true'))
    assert.match(await page.locator('#catalog-status').textContent(), new RegExp(`^${count} produto`))
    const expectedPreview = [...Map.groupBy(makeRows(count), (row) => row.brand.toLowerCase()).entries()]
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, 5)
      .reduce((sum, [, items]) => sum + Math.min(items.length, 5), 0)
    assert.equal(await page.locator('.product-card').count(), expectedPreview, `prévia para ${count}`)
    if (count > 5) {
      const firstBrand = await page.locator('.product-group-all').first().getAttribute('data-brand')
      await page.locator('.product-group-all').first().click()
      await page.waitForFunction(() => !document.getElementById('products').getAttribute('aria-busy')?.includes('true'))
      assert.equal(new URL(page.url()).searchParams.get('marca'), firstBrand)
      assert.equal(await page.locator('.product-card').count(), Math.min(count, 7))
      await page.locator('#catalog-clear').click()
      await page.waitForFunction(() => !document.getElementById('products').getAttribute('aria-busy')?.includes('true'))
    }
    if (count === 205) {
      assert.equal(await page.locator('.product-group').count(), 5)
      await page.locator('#catalog-more').click()
      await page.waitForFunction(() => !document.getElementById('products').getAttribute('aria-busy')?.includes('true'))
      assert.equal(await page.locator('.product-group').count(), 10)
    }
    assert.ok(calls() >= 2)
    await page.close()
  }

  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } })
    const calls = await setup(page, makeRows(36))
    await page.goto(`${base}/vitrine?categoria=Suplementos`)
    await page.waitForFunction(() => !document.getElementById('products').getAttribute('aria-busy')?.includes('true'))
    assert.equal(await page.locator('.product-card').count(), 18)
    assert.equal(await page.locator('#category').inputValue(), 'Suplementos')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow em ${width}px`)
    const controls = await page.evaluate(() => {
      const search = document.getElementById('catalog-search').getBoundingClientRect()
      const category = document.getElementById('category-trigger').getBoundingClientRect()
      return { search: search.toJSON(), category: category.toJSON() }
    })
    assert.equal(controls.search.height, 44)
    assert.equal(controls.category.height, 44)
    assert.ok(controls.category.right <= width && controls.search.right <= width, `filtros dentro de ${width}px`)
    if (width <= 640) assert.ok(controls.category.top >= controls.search.bottom + 8, 'filtros empilhados')
    else assert.ok(Math.abs(controls.category.top - controls.search.top) < 1, 'filtros alinhados')
    await page.locator('#category-trigger').click()
    assert.equal(await page.locator('#category-trigger').getAttribute('aria-expanded'), 'true')
    assert.equal(await page.getByRole('option', { name: 'Suplementos' }).getAttribute('aria-selected'), 'true')
    assert.ok(await page.locator('#category-options').evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
    }), `menu dentro da viewport em ${width}px`)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#category-trigger').getAttribute('aria-expanded'), 'false')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'category-trigger')
    await page.locator('#category-trigger').click()
    await page.mouse.click(4, 180)
    assert.equal(await page.locator('#category-trigger').getAttribute('aria-expanded'), 'false')
    await page.locator('#category-trigger').click()
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('#category-trigger').getAttribute('aria-expanded'), 'false')
    assert.equal(await page.evaluate(() => document.activeElement?.closest('#category-options') == null), true)
    if (width === 390) {
      await page.locator('#category-trigger').focus()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => document.getElementById('products')?.getAttribute('aria-busy') === 'false')
      assert.equal(new URL(page.url()).searchParams.get('categoria'), 'Acessórios')
      await page.locator('#category-trigger').click()
      await page.getByRole('option', { name: 'Suplementos' }).click()
      await page.waitForFunction(() => document.getElementById('products')?.getAttribute('aria-busy') === 'false')
      await page.setViewportSize({ width, height: 430 })
      await page.locator('#category-trigger').click()
      assert.equal(await page.locator('#category-options').getAttribute('data-placement'), 'top')
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width, height: 850 })
    }
    assert.ok(await page.locator('.product-card').first().evaluate((node) => node.getBoundingClientRect().width > 140))
    await page.locator('.product-image-button').first().click()
    assert.equal(await page.locator('#product-dialog').evaluate((node) => node.open), true)
    await page.locator('.product-dialog-image').getByText('Imagem indisponível').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#product-dialog').evaluate((node) => node.open), false)
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('product-image-button')), true)
    await page.locator('.product-image-button').first().click()
    await page.mouse.click(4, 180)
    assert.equal(await page.locator('#product-dialog').evaluate((node) => node.open), false)
    await page.locator('#catalog-search').fill('Produto 1')
    await page.waitForTimeout(350)
    assert.equal(new URL(page.url()).searchParams.get('busca'), 'Produto 1')
    assert.match(await page.locator('#catalog-status').textContent(), /produto/)
    await page.screenshot({ path: `/tmp/vitrine-redesign-${width}.png`, fullPage: true })
    if (width === 390) {
      await page.goBack()
      await page.waitForFunction(() => document.getElementById('catalog-search')?.value === '')
      await page.goForward()
      await page.waitForFunction(() => document.getElementById('catalog-search')?.value === 'Produto 1')
      await page.locator('.product-image-button').first().click()
      await page.evaluate(() => document.dispatchEvent(new Event('turbo:before-cache')))
      assert.equal(await page.locator('#product-dialog').evaluate((node) => node.open), false)
      await page.locator('.site-header .brand').click()
      await page.waitForURL(`${base}/`)
      const beforeReturn = calls()
      await page.goBack()
      await page.waitForFunction(() => document.getElementById('products')?.getAttribute('aria-busy') === 'false')
      assert.equal(calls() - beforeReturn, 2, 'retorno pelo Turbo consulta catálogo e categorias uma vez')
    }
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true })
    await setup(page, makeRows(6))
    await page.goto(`${base}/vitrine`)
    await page.locator('#category-trigger').tap()
    await page.getByRole('option', { name: 'Acessórios' }).tap()
    await page.waitForFunction(() => document.getElementById('products')?.getAttribute('aria-busy') === 'false')
    assert.equal(new URL(page.url()).searchParams.get('categoria'), 'Acessórios')
    await page.close()
  }
  {
    const page = await browser.newPage()
    await setup(page, makeRows(1))
    await page.route('**/rest/v1/rpc/public_product_catalog', async (route) => {
      if (route.request().method() !== 'OPTIONS') await new Promise((resolve) => setTimeout(resolve, 450))
      return route.fallback()
    })
    await page.goto(`${base}/vitrine`)
    assert.match(await page.locator('#catalog-status').textContent(), /Carregando/)
    assert.equal(await page.locator('#category-trigger').isDisabled(), true)
    await page.waitForFunction(() => document.getElementById('products')?.getAttribute('aria-busy') === 'false')
    assert.equal(await page.locator('#category-trigger').isDisabled(), false)
    await page.close()
  }
  {
    const page = await browser.newPage()
    await setup(page, makeRows(1))
    await page.route('**/rest/v1/rpc/public_product_catalog', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
      return route.fulfill({ status: 404, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ code: 'PGRST202', message: 'Function missing' }) })
    })
    await page.goto(`${base}/vitrine`)
    await page.locator('#catalog-status').getByText('A vitrine está temporariamente indisponível.').waitFor()
    assert.equal(await page.locator('#catalog-status').getAttribute('data-state'), 'error')
    assert.equal(await page.locator('.product-card').count(), 0)
    assert.equal(await page.locator('.catalog-retry button').isVisible(), true)
    assert.equal(await page.locator('#category-trigger').isDisabled(), false)
    await page.close()
  }
  console.log('Vitrine: cenários 0, 1, 6, 36 e 205; filtros, URL, modal e 6 larguras OK')
} finally { await browser.close() }

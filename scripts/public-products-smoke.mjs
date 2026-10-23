import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

// Mocks isolados desta suíte: nunca aceita produtos reais do backend como prova de que a
// UI funciona (0, 1 ou muitos resultados têm que funcionar igual). A RPC real continua
// sendo exercitada pelos outros smokes públicos (ver public-browser-smoke.mjs).
const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const executablePath = process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'

const IMG = 'https://images.example.com/produto.jpg'
// PNG 1x1 válido, para que o <img> mockado realmente decodifique (não só retorne 200).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

async function mockImages(page) {
  await page.route('https://images.example.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }))
}

// A sandbox não tem saída de rede real para a loja do parceiro: intercepta só para provar
// que o clique abriu a URL certa em aba nova, sem depender de internet externa.
async function mockStore(page) {
  // No contexto (não só na página): o popup de "Ver na loja" nasce como uma Page nova no
  // mesmo contexto, e uma rota registrada só na página de origem não o alcançaria.
  await page.context().route('https://loja-exemplo.com.br/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Loja</title>' }))
}

function product(id, overrides = {}) {
  return {
    id: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`,
    name: `Produto ${id}`,
    brand: overrides.brand ?? `Marca ${Math.ceil(id / 3)}`,
    description: `Descrição do produto ${id}, com detalhes suficientes para testar o corte visual de texto longo em duas linhas no card e o texto completo no modal de ampliação.`,
    category: overrides.category ?? 'Suplementos',
    image_url: overrides.image_url === undefined ? IMG : overrides.image_url,
    store_url: overrides.store_url ?? `https://loja-exemplo.com.br/produto-${id}`,
    sponsored: Boolean(overrides.sponsored),
    ...overrides,
  }
}

function groupsFixture(items) {
  const byBrand = new Map()
  for (const item of items) {
    if (!byBrand.has(item.brand)) byBrand.set(item.brand, [])
    byBrand.get(item.brand).push(item)
  }
  const groups = [...byBrand.entries()].map(([brand, list]) => ({
    key: brand.toLowerCase(),
    brand,
    count: list.length,
    items: list.slice(0, 5),
  }))
  return { totalProducts: items.length, totalBrands: groups.length, groups }
}

async function mockCatalog(page, items, { categories = ['Suplementos', 'Vestuário'], fail = false, delayMs = 0 } = {}) {
  await page.route('**/rest/v1/rpc/public_product_catalog', async (route) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const body = route.request().postDataJSON()
    if (fail) return route.fulfill({ status: 500, body: JSON.stringify({ code: 'UNKNOWN' }) })
    if (body.p_mode === 'categories') return route.fulfill({ status: 200, body: JSON.stringify(categories) })
    const search = String(body.p_search || '').toLowerCase()
    const category = String(body.p_category || '')
    const brand = String(body.p_brand || '').toLowerCase()
    const filtered = items.filter((item) =>
      (!search || item.name.toLowerCase().includes(search) || item.brand.toLowerCase().includes(search)) &&
      (!category || item.category === category) &&
      (!brand || item.brand.toLowerCase() === brand)
    )
    if (body.p_mode === 'groups') {
      const page_ = groupsFixture(filtered)
      return route.fulfill({ status: 200, body: JSON.stringify(page_) })
    }
    const offset = Number(body.p_offset) || 0
    const limit = Number(body.p_limit) || 20
    const slice = filtered.slice(offset, offset + limit)
    return route.fulfill({ status: 200, body: JSON.stringify({ totalProducts: filtered.length, totalBrands: new Set(filtered.map((i) => i.brand)).size, items: slice }) })
  })
}

const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
try {
  // 1) Zero produtos: estado vazio, sem travar a UI.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 850 } })
    await mockImages(page)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await mockCatalog(page, [])
    await page.goto(`${base}/vitrine`)
    await page.locator('[role="status"]').getByText('0 produtos encontrados').waitFor()
    await page.getByText('Nenhum produto encontrado').waitFor()
    assert.deepEqual(errors, [], 'console limpo com catálogo vazio')
    await page.close()
  }

  // 2) Um produto só: card não estica a largura inteira do grid.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await mockImages(page)
    await mockCatalog(page, [product(1)])
    await page.goto(`${base}/vitrine`)
    await page.locator('article').first().waitFor()
    const [cardWidth, gridWidth] = await page.evaluate(() => {
      const card = document.querySelector('article')
      const grid = card.parentElement
      return [card.getBoundingClientRect().width, grid.getBoundingClientRect().width]
    })
    assert.ok(cardWidth < gridWidth * 0.7, `card único não deveria esticar (card=${cardWidth} grid=${gridWidth})`)
    await page.close()
  }

  // 3) Muitos produtos em várias marcas: agrupamento por marca + "ver todos".
  {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } })
    await mockImages(page)
    const items = [
      ...Array.from({ length: 8 }, (_, i) => product(i + 1, { brand: 'Marca Grande' })),
      ...Array.from({ length: 28 }, (_, i) => product(i + 9)),
    ]
    await mockCatalog(page, items)
    await page.goto(`${base}/vitrine`)
    await page.locator('h2').first().waitFor()
    assert.ok((await page.locator('h2').count()) >= 3, 'agrupado por marca mostra várias seções')
    await page.getByRole('button', { name: /Ver todos os \d+ produtos/ }).first().click()
    await page.waitForFunction(() => new URLSearchParams(location.search).get('marca'))
    await page.locator('h2').first().waitFor({ state: 'detached' }).catch(() => {})
    await page.close()
  }

  // 4) Busca, categoria, limpar filtros e URL compartilhável.
  {
    const page = await browser.newPage({ viewport: { width: 768, height: 900 } })
    await mockImages(page)
    const items = [
      product(1, { name: 'Whey Protein', brand: 'Marca Um', category: 'Suplementos' }),
      product(2, { name: 'Camiseta Dry-fit', brand: 'Marca Dois', category: 'Vestuário' }),
    ]
    await mockCatalog(page, items)
    await page.goto(`${base}/vitrine`)
    await page.getByPlaceholder('Buscar produtos ou marcas').fill('whey')
    await page.waitForFunction(() => new URLSearchParams(location.search).get('busca') === 'whey', null, { timeout: 2000 })
    await page.getByText('Whey Protein').waitFor()
    assert.equal(await page.getByText('Camiseta Dry-fit').count(), 0)
    await page.getByRole('button', { name: 'Limpar filtros' }).click()
    await page.waitForFunction(() => !new URLSearchParams(location.search).get('busca'))
    await page.selectOption('select', { label: 'Vestuário' })
    await page.waitForFunction(() => new URLSearchParams(location.search).get('categoria') === 'Vestuário')
    await page.getByText('Camiseta Dry-fit').waitFor()
    assert.equal(await page.getByText('Whey Protein').count(), 0)
    const shareable = new URL(page.url())
    await page.reload()
    assert.equal(new URL(page.url()).search, shareable.search, 'URL de filtro sobrevive ao F5')
    await page.getByText('Camiseta Dry-fit').waitFor()
    await page.close()
  }

  // 5) Ampliação real: clique na imagem abre Dialog Primer visível, X/Esc/backdrop fecham, reabre.
  // Testa nos dois temas e em mobile + desktop — este é o requisito crítico da tarefa.
  for (const [theme, width] of [['light', 390], ['dark', 390], ['light', 1440], ['dark', 1440]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await mockImages(page)
    await page.addInitScript((mode) => localStorage.setItem('colorMode', mode), theme)
    await mockCatalog(page, [product(1, { sponsored: true })])
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${base}/vitrine`)
    await page.getByRole('button', { name: /Ampliar imagem/ }).waitFor()
    await page.getByRole('button', { name: /Ampliar imagem/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible' })
    assert.ok(await dialog.locator('img').first().isVisible(), 'imagem ampliada visível no modal')
    const bg = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)
    assert.notEqual(bg, 'rgba(0, 0, 0, 0)', `modal precisa ter superfície opaca (tema ${theme}, ${width}px)`)
    await page.screenshot({ path: `/tmp/vitrine-zoom-${theme}-${width}.png` })

    // Fecha por X
    await dialog.getByRole('button', { name: /close|fechar/i }).click()
    await dialog.waitFor({ state: 'hidden' })

    // Reabre, fecha por Esc
    await page.getByRole('button', { name: /Ampliar imagem/ }).click()
    await dialog.waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })

    // Reabre, fecha pelo backdrop. Clica no canto inferior: perto do topo o header
    // compartilhado (sticky, z-index acima do backdrop sem z-index próprio) intercepta o
    // clique antes dele chegar ao backdrop — comportamento do header, não da Vitrine.
    await page.getByRole('button', { name: /Ampliar imagem/ }).click()
    await dialog.waitFor({ state: 'visible' })
    await page.mouse.click(width - 10, 900 - 10)
    await dialog.waitFor({ state: 'hidden' })

    // Foco volta ao gatilho
    assert.ok(await page.getByRole('button', { name: /Ampliar imagem/ }).evaluate((el) => el === document.activeElement))
    assert.deepEqual(errors, [], `sem erros de JS no ciclo de ampliação (tema ${theme}, ${width}px)`)
    await page.close()
  }

  // 6) "Ver na loja" é independente: abre aba nova, nunca a ampliação; rel correto para patrocinado.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 850 } })
    await mockImages(page)
    await mockStore(page)
    await mockCatalog(page, [product(1, { sponsored: true })])
    await page.goto(`${base}/vitrine`)
    const link = page.getByRole('link', { name: 'Ver na loja' }).first()
    await link.waitFor()
    assert.equal(await link.getAttribute('target'), '_blank')
    assert.match(await link.getAttribute('rel'), /noopener/)
    assert.match(await link.getAttribute('rel'), /sponsored/)
    const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()])
    await popup.waitForLoadState('domcontentloaded').catch(() => {})
    assert.ok(popup.url().startsWith('https://loja-exemplo.com.br'), `popup.url()=${popup.url()}`)
    await popup.close()
    assert.equal(await page.getByRole('dialog').count(), 0, '"Ver na loja" não deve abrir o modal de ampliação')
    await page.close()
  }

  // 7) Erro de rede com "tentar de novo" + carregar mais.
  {
    const page = await browser.newPage({ viewport: { width: 768, height: 900 } })
    await mockImages(page)
    const items = Array.from({ length: 25 }, (_, i) => product(i + 1, { brand: 'Marca Única', category: 'Equipamentos' }))
    await mockCatalog(page, items, { fail: true })
    await page.goto(`${base}/vitrine`)
    await page.getByText('Não foi possível carregar os produtos').waitFor()
    const retry = page.getByRole('button', { name: 'Tentar de novo' })
    await retry.waitFor()
    await page.unroute('**/rest/v1/rpc/public_product_catalog')
    await mockCatalog(page, items)
    await retry.click()
    await page.getByText('25 produtos encontrados').waitFor()
    await page.getByPlaceholder('Buscar produtos ou marcas').fill('marca')
    await page.waitForFunction(() => new URLSearchParams(location.search).get('busca') === 'marca')
    await page.getByRole('button', { name: 'Carregar mais' }).click()
    await page.getByText('25 produtos encontrados').waitFor()
    await page.close()
  }

  // 8) Sem overflow horizontal em nenhuma largura exigida, nos dois temas.
  for (const width of [320, 390, 768, 1440]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 850 } })
      await mockImages(page)
      await page.addInitScript((mode) => localStorage.setItem('colorMode', mode), theme)
      const items = Array.from({ length: 6 }, (_, i) => product(i + 1))
      await mockCatalog(page, items)
      await page.goto(`${base}/vitrine`)
      await page.getByText(/produtos? encontrados?/).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow em ${width}px ${theme}`)
      if (width === 390 || width === 1440) await page.screenshot({ path: `/tmp/vitrine-${theme}-${width}.png`, fullPage: true })
      await page.close()
    }
  }

  // 9) Turbo: sair da Vitrine e voltar não duplica montagem nem deixa listeners presos.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 850 } })
    await mockImages(page)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await mockCatalog(page, [product(1)])
    await page.goto(`${base}/vitrine`)
    await page.getByRole('button', { name: /Ampliar imagem/ }).waitFor()
    await page.locator('.public-header-trigger').click()
    await page.locator('.public-header-overlay a[href="/"]').click()
    await page.waitForURL(`${base}/`)
    await page.goBack()
    await page.waitForURL(`${base}/vitrine`)
    await mockCatalog(page, [product(1)])
    await page.getByRole('button', { name: /Ampliar imagem/ }).waitFor()
    assert.equal(await page.locator('[role="status"][aria-live="polite"]').count(), 1, 'sem montagem duplicada da ilha após voltar com Turbo')
    assert.deepEqual(errors, [])
    await page.close()
  }

  console.log('PUBLIC_PRODUCTS_SMOKE_OK')
} finally {
  await browser.close()
}

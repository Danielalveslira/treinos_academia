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
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`)
    })
    page.on('pageerror', (error) => errors.push(error.message))
    for (const [path, heading] of [
      ['/', 'Planeje, registre e acompanhe seus treinos.'],
      ['/como-funciona', 'Seu treino organizado. Sua evolução visível.'],
      ['/para-empresas', 'Sua marca no universo fitness.'],
      ['/vitrine', 'Vitrine'],
      ['/profissionais', 'Profissionais'],
    ]) {
      const response = await page.goto(`${base}${path}`)
      assert.equal(response.status(), 200, path)
      assert.equal((await page.locator('h1').textContent()).replace(/\s+/g, ' ').trim(), heading)
      assert.equal(await page.locator('h1').count(), 1)
      await page.locator('.home-image img[loading="eager"]').evaluateAll(async (images) => {
        await Promise.all(images.map((img) => img.decode()))
      })
      if (width === 390 || width === 1366) {
        await page.locator('.home-image img').evaluateAll(async (images) => {
          await Promise.all(images.map(async (img) => {
            img.loading = 'eager'
            await img.decode()
          }))
        })
      }
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
      ['/como-funciona', 'Seu treino organizado. Sua evolução visível.'],
      ['/para-empresas', 'Sua marca no universo fitness.'],
      ['/vitrine', 'Vitrine'],
      ['/profissionais', 'Profissionais'],
    ]) {
      await page.locator('.public-header-trigger').click()
      await page
        .locator(`.public-header-overlay a[href="${href}"]`)
        .click()
      await page.waitForURL(`${base}${href}`)
      await page.waitForFunction((expected) =>
        document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() === expected, heading)
      assert.equal(new URL(page.url()).pathname, href)
      assert.equal((await page.locator('h1').textContent()).replace(/\s+/g, ' ').trim(), heading)
      await page.locator('#public-header .public-header-brand').click()
      await page.waitForURL(base + '/')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Planeje, registre e acompanhe seus treinos.'))
      assert.equal(new URL(page.url()).pathname, '/')
    }
    assert.deepEqual(errors, [], `erros no console das páginas públicas em ${width}px`)
    await page.goto(`${base}/login`)
    await page.locator('.public-header .brand').click()
    assert.equal(new URL(page.url()).pathname, '/')
    assert.equal(
      (await page.locator('h1').textContent()).replace(/\s+/g, ' ').trim(),
      'Planeje, registre e acompanhe seus treinos.'
    )
    await page.screenshot({ path: `/tmp/evolutus-public-${width}.png`, fullPage: true })
    await page.close()
  }
  console.log('PUBLIC_BROWSER_SMOKE_OK')
} finally {
  await browser.close()
}

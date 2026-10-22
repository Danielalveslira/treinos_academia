import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const executablePath =
  process.env.CHROMIUM_PATH ||
  '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
const paths = ['/', '/como-funciona', '/para-empresas', '/vitrine', '/profissionais']
const links = [
  '/',
  '/como-funciona',
  '/para-empresas',
  '/vitrine',
  '/profissionais',
  '/login',
  '/cadastro',
]
const proofDir = process.env.PUBLIC_PROOF_DIR || 'docs/public-ui-qa/hamburger-proof-2026-10-22'
mkdirSync(proofDir, { recursive: true })

async function assertVisibleTrigger(page, context, { requireHit = true } = {}) {
  const trigger = page.getByRole('button', { name: 'Menu de navegação' })
  await trigger.waitFor({ state: 'visible' })
  assert.equal(await trigger.isVisible(), true, `${context}: botão invisível`)
  const box = await trigger.boundingBox()
  assert.ok(box && box.width > 0 && box.height > 0, `${context}: caixa vazia`)
  const hit = await trigger.evaluate((button) => {
    const rect = button.getBoundingClientRect()
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    const style = getComputedStyle(button)
    return {
      inside: button === target || button.contains(target),
      display: style.display,
      visibility: style.visibility,
      opacity: Number(style.opacity),
      pointerEvents: style.pointerEvents,
    }
  })
  assert.ok(
    box.x >= 0 && box.y >= 0 && box.x + box.width <= page.viewportSize().width + 1,
    `${context}: fora da viewport`
  )
  if (requireHit) assert.ok(hit.inside, `${context}: botão coberto`)
  assert.ok(
    hit.display !== 'none' &&
      hit.visibility === 'visible' &&
      hit.opacity > 0 &&
      hit.pointerEvents !== 'none',
    `${context}: CSS oculta o botão`
  )
  return trigger
}
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme: theme,
    })
    await page.addInitScript((mode) => localStorage.setItem('colorMode', mode), theme)
    let releaseMenuChunk
    const menuChunkReady = new Promise((resolve) => {
      releaseMenuChunk = resolve
    })
    const menuChunk = base.includes(':5173') ? '**/src/PublicHeaderMenu.jsx*' : '**/assets/publicHeaderMenu-*.js'
    await page.route(menuChunk, async (route) => {
      await menuChunkReady
      await route.continue()
    })
    await page.goto(base + '/', { waitUntil: 'commit' })
    await page.locator('#public-header-menu-root').waitFor({ state: 'attached' })
    assert.equal(await page.locator('#public-header-menu-root').count(), 1)
    assert.equal(await page.locator('.public-header-trigger').count(), 1)
    await assertVisibleTrigger(page, `HTML inicial 390 ${theme}`)
    await page.screenshot({ path: `${proofDir}/home-390-${theme}-before-js.png` })
    releaseMenuChunk()
    await page.locator('#public-header-menu-root button[tabindex="0"]').waitFor()
    await page.getByRole('button', { name: 'Menu de navegação' }).click()
    await page.locator('.public-header-overlay').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.public-header-overlay').waitFor({ state: 'detached' })
    await assertVisibleTrigger(page, `React montado 390 ${theme}`)
    await page.getByRole('button', { name: 'Menu de navegação' }).evaluate((button) => button.blur())
    await page.screenshot({ path: `${proofDir}/home-390-${theme}-after-js.png` })
    await page.waitForTimeout(2200)
    await assertVisibleTrigger(page, `tardio 390 ${theme}`)
    await page.screenshot({ path: `${proofDir}/home-390-${theme}-late.png` })
    await page.close()
  }
  for (const width of [320, 390, 768, 1440])
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, colorScheme: theme })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await page.addInitScript((mode) => localStorage.setItem('colorMode', mode), theme)
      for (const path of paths) {
        const response = await page.goto(base + path)
        assert.equal(response.status(), 200)
        await page.locator('.public-header-trigger').waitFor({ state: 'attached' })
        assert.equal(await page.locator('.public-header-trigger').count(), 1)
        assert.equal(await page.locator('details, #public-menu-panel').count(), 0)
        assert.equal(await page.evaluate(() => document.documentElement.dataset.publicTheme), theme)
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `${path} overflow ${width} ${theme}`
        )
        const trigger = await assertVisibleTrigger(page, `${path} ${width} ${theme}`)
        await trigger.click()
        const overlay = page.locator('.public-header-overlay')
        await overlay.waitFor()
        assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
        assert.deepEqual(
          await overlay
            .locator('a[href]')
            .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href'))),
          links
        )
        const box = await overlay.boundingBox()
        assert.ok(box.x >= -1 && box.x + box.width <= width + 1, `overlay fora da tela ${width}`)
        assert.ok(
          await overlay.evaluate(
            (node) => getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)'
          )
        )
        await page.waitForTimeout(350)
        if (path === '/' || (width === 390 && (path === '/vitrine' || path === '/profissionais')))
          await page.screenshot({
            path: `${proofDir}/${path === '/' ? 'home' : path.slice(1)}-${width}-${theme}-open.png`,
          })
        await page.waitForTimeout(450)
        assert.equal(await page.evaluate(() => document.documentElement.dataset.publicTheme), theme)
        await assertVisibleTrigger(page, `${path} ${width} ${theme} tardio`, { requireHit: width >= 768 })
        assert.ok(
          await overlay.evaluate(
            (node) => getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)'
          )
        )
        if (width < 768) await page.locator('#__primerPortalRoot__ button').first().click()
        else await trigger.click()
        await overlay.waitFor({ state: 'detached' })
        await trigger.click()
        await page.keyboard.press('Escape')
        await overlay.waitFor({ state: 'detached' })
        assert.ok(
          await trigger.evaluate((node) => node === document.activeElement),
          'Escape deve devolver foco ao botão'
        )
        await trigger.click()
        if (width >= 768) {
          await page.mouse.click(10, 200)
          await overlay.waitFor({ state: 'detached' })
        } else {
          await page.keyboard.press('Tab')
          assert.ok(await page.evaluate(() => document.activeElement !== document.body))
          await page.keyboard.press('Escape')
          await overlay.waitFor({ state: 'detached' })
        }
        assert.deepEqual(errors, [], `${path} ${width} ${theme}`)
      }
      await page.goto(base + '/')
      await page.locator('.public-header-trigger').click()
      await page.locator('.public-header-overlay a[href="/vitrine"]').click()
      await page.waitForURL(base + '/vitrine')
      assert.equal(await page.locator('.public-header-trigger').count(), 1)
      assert.equal(await page.locator('.public-header-overlay').count(), 0)
      await page.reload()
      assert.equal(await page.locator('.public-header-trigger').count(), 1)
      await page.close()
    }
  console.log('PUBLIC_HEADER_MENU_SMOKE_OK')
} finally {
  await browser.close()
}

import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const pages = [
  ['/', 'home', ['quadro-geral']],
]
const widths = [320, 375, 768, 1366, 1440]
const folder = 'docs/banner-captures'
mkdirSync(folder, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox'],
})
try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
    await page.addInitScript(() => localStorage.setItem('colorMode', 'dark'))
    for (const [route, slug, expected] of pages) {
      await page.goto(`http://127.0.0.1:4173${route}`, { waitUntil: 'networkidle' })
      const images = page.locator('.home-image img')
      assert.equal(await images.count(), expected.length, `${route}: banner count`)
      assert.equal(await page.locator('.product-preview, .features-hero-art').count(), 0)
      for (let i = 0; i < expected.length; i++) {
        const image = images.nth(i)
        assert.match(await image.getAttribute('src'), new RegExp(`${expected[i]}-960\\.webp$`))
        assert.equal(await image.getAttribute('loading'), 'eager')
        await image.scrollIntoViewIfNeeded()
        await image.evaluate((node) => node.decode())
        const metrics = await image.evaluate((node) => ({
          naturalWidth: node.naturalWidth,
          naturalHeight: node.naturalHeight,
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        }))
        assert.ok(metrics.naturalWidth > 0 && metrics.naturalHeight > 0, `${route}: image loaded`)
        assert.ok(Math.abs(metrics.width / metrics.height - 2) < 0.02, `${route}: no distortion`)
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      assert.ok(overflow <= 1, `${route} at ${width}px overflows by ${overflow}px`)
      await page.evaluate(() => scrollTo(0, 0))
      await page.screenshot({ path: `${folder}/${slug}-${width}.png`, fullPage: true })
    }
    await page.close()
  }
  console.log('PUBLIC_BANNERS_SMOKE_OK')
} finally {
  await browser.close()
}

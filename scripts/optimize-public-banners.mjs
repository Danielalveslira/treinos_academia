import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const sourceDir = new URL('../docs/banner-sources/', import.meta.url)
const outputDir = new URL('../public/img/banners/', import.meta.url)
const banners = [
  ['quadro geral.png', 'quadro-geral'],
  ['exercicio.png', 'exercicio'],
  ['progresso.png', 'progresso'],
  ['comunidade.png', 'comunidade'],
]
mkdirSync(outputDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage()
  for (const [filename, slug] of banners) {
    const source = readFileSync(new URL(filename, sourceDir)).toString('base64')
    for (const width of [960, 1774]) {
      const dataUrl = await page.evaluate(async ({ source, width }) => {
        const image = new Image()
        image.src = `data:image/png;base64,${source}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = Math.round(width * image.naturalHeight / image.naturalWidth)
        const context = canvas.getContext('2d')
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        return canvas.toDataURL('image/webp', 0.9)
      }, { source, width })
      if (!dataUrl.startsWith('data:image/webp;base64,')) throw new Error('WebP encoding unavailable')
      const output = `${slug}-${width}.webp`
      const bytes = Buffer.from(dataUrl.slice('data:image/webp;base64,'.length), 'base64')
      writeFileSync(new URL(output, outputDir), bytes)
      process.stdout.write(`${output}: ${bytes.length} bytes\n`)
    }
  }
} finally {
  await browser.close()
}

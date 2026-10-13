// Synthetic canvas fixtures for local tests; these are never production exercise artwork.
import { chromium } from 'playwright-core'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
export async function ensureVisualTestFixtures() {
  const dir = '/tmp/exercise-visual-fixtures'
  try {
    await Promise.all(
      ['start', 'end', 'thumb', 'landscape'].map((role) => access(`${dir}/${role}.webp`))
    )
    return dir
  } catch {
    /* Generate synthetic test data only. */
  }
  await mkdir(dir, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    for (const [role, size] of [
      ['start', 1024],
      ['end', 1024],
      ['thumb', 320],
      ['landscape', 1024],
    ]) {
      const base64 = await page.evaluate(
        ({ role, size }) => {
          const c = document.createElement('canvas')
          c.width = c.height = size
          const x = c.getContext('2d')
          x.scale(size / 1024, size / 1024)
          if (role === 'landscape') {
            x.fillStyle = '#cdeeff'
            x.fillRect(0, 0, 1024, 1024)
            x.fillStyle = '#4d9860'
            x.beginPath()
            x.moveTo(0, 800)
            x.lineTo(300, 150)
            x.lineTo(800, 950)
            x.fill()
            return c.toDataURL('image/webp').split(',')[1]
          }
          const final = role === 'end'
          x.strokeStyle = '#555b66'
          x.lineWidth = 42
          x.lineCap = 'round'
          x.fillStyle = '#c6a282'
          x.beginPath()
          x.arc(520, 185, 55, 0, 7)
          x.fill()
          x.fillStyle = '#cbd0d5'
          x.fillRect(460, 250, 120, 200)
          x.beginPath()
          x.moveTo(485, 460)
          x.lineTo(445, 710)
          x.lineTo(420, 820)
          x.moveTo(555, 460)
          x.lineTo(600, 710)
          x.lineTo(630, 820)
          x.stroke()
          x.strokeStyle = '#c6a282'
          x.lineWidth = 30
          x.beginPath()
          x.moveTo(460, 285)
          x.lineTo(final ? 320 : 420, final ? 300 : 475)
          x.lineTo(final ? 300 : 400, final ? 140 : 560)
          x.moveTo(580, 285)
          x.lineTo(final ? 710 : 620, final ? 300 : 475)
          x.lineTo(final ? 730 : 640, final ? 140 : 560)
          x.stroke()
          x.fillStyle = '#343d4c'
          for (const px of final ? [300, 730] : [400, 640])
            x.fillRect(px - 50, final ? 120 : 540, 100, 38)
          return c.toDataURL('image/webp').split(',')[1]
        },
        { role, size }
      )
      await writeFile(`${dir}/${role}.webp`, Buffer.from(base64, 'base64'))
    }
  } finally {
    await browser.close()
  }
  return dir
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  console.log(await ensureVisualTestFixtures())

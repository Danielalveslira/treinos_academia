import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const url = process.env.DEMO_URL || 'http://localhost:5173/demo'
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
})
try {
  const errors = []
  const trainingRequests = []
  for (const [width, height] of [
    [320, 568],
    [360, 800],
    [390, 844],
    [430, 932],
    [1280, 800],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (
        /\/rest\/v1\/workouts|\/rpc\/.*(workout|economy|evocoin)|\/functions\/v1\/.*(workout|economy)/i.test(
          request.url()
        )
      )
        trainingRequests.push(`${request.method()} ${request.url()}`)
    })
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Treino A — Peito e Tríceps' }).waitFor()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `overflow at ${width}px`
    )
    if (width === 320) {
      assert.equal(
        await page.getByRole('heading', { name: 'Experimente registrar um treino' }).count(),
        1
      )
      assert.equal(await page.getByText('Sugerido do último treino (exemplo)').count(), 1)
      assert.equal(await page.getByText('0 de 12 séries concluídas').count(), 1)
      const small = await page.locator('button:visible').evaluateAll((buttons) =>
        buttons
          .filter((button) => {
            const box = button.getBoundingClientRect()
            return box.width < 44 || box.height < 44
          })
        .map((button) => `${button.getAttribute('aria-label') || button.textContent?.trim()}: ${button.getBoundingClientRect().width.toFixed(1)}×${button.getBoundingClientRect().height.toFixed(1)}`)
      )
      assert.deepEqual(small, [], 'tap targets below 44px')
      await page.screenshot({ path: '/tmp/evolutus-demo-v2-mobile.png', fullPage: true })
      await page.getByRole('button', { name: 'Concluir série' }).dblclick()
      assert.equal(
        await page.getByText('1 de 12 séries concluídas').count(),
        1,
        'double tap recorded more than one set'
      )
      await page.getByText('Série 2 de 3').waitFor()
      assert.equal(await page.getByText('Descanso ·').count(), 0)
      await page.getByRole('button', { name: 'Série 1, concluída' }).click()
      await page.getByLabel('Peso (kg)').fill('62,5')
      await page.getByRole('button', { name: 'Atualizar série' }).click()
      await page.getByRole('button', { name: 'Série 2, pendente' }).click()
      await page.waitForTimeout(450)
      await page.getByRole('button', { name: 'Concluir série' }).click()
      await page.waitForTimeout(450)
      await page.getByRole('button', { name: 'Concluir série' }).click()
      await page.getByRole('heading', { name: 'Exercício concluído' }).waitFor()
      await page.getByRole('button', { name: 'Próximo exercício' }).click()
      await page.getByText('Supino inclinado com halteres').first().waitFor()
      await page.getByRole('button', { name: /Ver resumo da amostra/ }).click()
      await page.getByRole('heading', { name: 'Resumo da demonstração' }).waitFor()
      assert.equal(await page.locator('.demo-summary-grid').getByText('3 de 12').count(), 1)
      await page.getByRole('link', { name: 'Criar conta e registrar meus treinos' }).waitFor()
      await page.getByRole('button', { name: 'Repetir demonstração' }).click()
      assert.equal(await page.getByText('0 de 12 séries concluídas').count(), 1)
      await page.reload({ waitUntil: 'networkidle' })
      assert.equal(await page.getByText('0 de 12 séries concluídas').count(), 1)
      const initialMode = await page.locator('html').getAttribute('data-color-mode')
      await page.locator('.public-theme-trigger').click()
      assert.equal(
        await page.locator('html').getAttribute('data-color-mode'),
        initialMode === 'dark' ? 'light' : 'dark'
      )
      await page.screenshot({ path: '/tmp/evolutus-demo-v2-alt-theme.png', fullPage: true })
    }
    if (width === 1280) await page.screenshot({ path: '/tmp/evolutus-demo-v2-desktop.png' })
    await page.close()
  }
  assert.deepEqual(errors, [], 'page errors')
  assert.deepEqual(trainingRequests, [], 'training service requests')
  console.log('Demo V2 OK: 320–430px e desktop, jornada, tema, reinício e sem serviços de treino.')
} finally {
  await browser.close()
}

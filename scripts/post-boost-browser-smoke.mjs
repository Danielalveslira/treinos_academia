// Real React/Primer modal, isolated RPC fixtures. No production credentials or purchases.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const port = 5187
const origin = `http://127.0.0.1:${port}`
const server = spawn(
  'node_modules/.bin/vite',
  ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  {
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'http://127.0.0.1:9999',
      VITE_SUPABASE_ANON_KEY: 'synthetic-preview-key',
    },
    stdio: 'ignore',
  }
)
let browser
try {
  let ready = false
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null) throw Error('Vite preview exited before readiness')
    try {
      const response = await fetch(`${origin}/tests/fixtures/post-boost-preview.html`)
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      /* waiting for local server */
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.ok(ready, 'local preview server starts')
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const evidence = []
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(`${origin}/tests/fixtures/post-boost-preview.html`)
    await page.getByText('7 EvoCash/dia').waitFor()
    assert.deepEqual(
      await page.evaluate(() => window.__boostCalls),
      ['get_direct_post_boost_offer'],
      'opening is read-only'
    )
    await page.getByRole('spinbutton', { name: 'Duração em dias' }).fill('3')
    await page.getByRole('button', { name: 'Revisar valor' }).click()
    await page.getByRole('button', { name: 'Confirmar promoção' }).waitFor()
    const metrics = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]').getBoundingClientRect()
      const confirm = [...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('Confirmar promoção'))
        .getBoundingClientRect()
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        dialogLeft: dialog.left,
        dialogRight: dialog.right,
        confirmTop: confirm.top,
        confirmBottom: confirm.bottom,
      }
    })
    assert.equal(metrics.scrollWidth, metrics.clientWidth, `${width}px has no horizontal overflow`)
    assert.ok(
      metrics.dialogLeft >= 0 && metrics.dialogRight <= width,
      `${width}px dialog stays within viewport`
    )
    assert.ok(
      Math.abs(metrics.dialogLeft - (width - metrics.dialogRight)) <= 1,
      `${width}px dialog is centered`
    )
    assert.ok(
      metrics.confirmTop >= 0 && metrics.confirmBottom <= 800,
      `${width}px confirm action stays visible`
    )
    assert.deepEqual(await page.evaluate(() => window.__boostCalls), [
      'get_direct_post_boost_offer',
      'prepare_direct_post_boost',
      'quote_commercial_order',
    ])
    assert.deepEqual(pageErrors, [], `${width}px has no page error`)
    if (process.env.BOOST_SCREENSHOTS_DIR && [390, 1024].includes(width)) {
      await mkdir(process.env.BOOST_SCREENSHOTS_DIR, { recursive: true })
      await page.screenshot({
        path: `${process.env.BOOST_SCREENSHOTS_DIR}/${width === 390 ? 'mobile-390' : 'desktop-1024'}.png`,
        fullPage: true,
      })
    }
    if (width === 390) {
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Confirmar promoção' }).click()
      await page.getByText('Promoção ativada!').waitFor()
      assert.equal(
        (await page.evaluate(() => window.__boostCalls)).filter(
          (name) => name === 'confirm_commercial_order_with_terms'
        ).length,
        1
      )
    }
    evidence.push({ width, ...metrics })
    await page.close()
  }
  const expiredPage = await browser.newPage({ viewport: { width: 390, height: 800 } })
  await expiredPage.goto(`${origin}/tests/fixtures/post-boost-preview.html?expired=1`)
  await expiredPage.getByText('7 EvoCash/dia').waitFor()
  await expiredPage.getByRole('spinbutton', { name: 'Duração em dias' }).fill('3')
  await expiredPage.getByRole('button', { name: 'Revisar valor' }).click()
  await expiredPage.getByRole('button', { name: 'Confirmar promoção' }).waitFor()
  await expiredPage.getByRole('checkbox').check()
  await expiredPage.getByRole('button', { name: 'Confirmar promoção' }).click()
  await expiredPage.getByText('A cotação venceu.').waitFor()
  await expiredPage.getByRole('button', { name: 'Revisar valor' }).click()
  await expiredPage.getByRole('button', { name: 'Confirmar promoção' }).waitFor()
  assert.equal(
    (await expiredPage.evaluate(() => window.__boostCalls)).filter(
      (name) => name === 'quote_commercial_order'
    ).length,
    2,
    'expired quote can be requested again'
  )
  await expiredPage.close()
  console.log(JSON.stringify({ passed: true, widths: evidence }, null, 2))
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}

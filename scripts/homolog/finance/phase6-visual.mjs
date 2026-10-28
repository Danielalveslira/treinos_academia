import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { advertisingContext } from './phase6-browser-context.mjs'
const access = JSON.parse(readFileSync('.finance-local/phase6-access.json'))
const story = JSON.parse(readFileSync('docs/finance-restructure/phase6/evidence/lifecycle.json'))
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE6_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const checks = [],
  errors = [],
  warnings = [],
  httpFailures = []
try {
  for (const width of [320, 390, 1440])
    for (const mode of ['light', 'dark']) {
      for (const [name, route, session, expected] of [
        ['home', '/app', access.viewer, 'Evolutus'],
        [
          'community',
          '/comunidades/' + story.community,
          access.viewer,
          'Comunidade sintética Fase 6',
        ],
        [
          'central',
          '/meus-anuncios?accountId=' + story.account,
          access.owner,
          'Central de publicidade',
        ],
        ['admin', '/admin/parcerias?tab=autonomous', access.admin, 'Publicidade autônoma'],
        ['metrics', '/meus-anuncios?accountId=' + story.account, access.owner, 'Dias de medição'],
      ]) {
        const context = await advertisingContext(browser, session, width, mode)
        const page = await context.newPage()
        page.on('response', async (response) => {
          if (response.status() >= 400)
            httpFailures.push({
              name,
              width,
              mode,
              path: new URL(response.url()).pathname,
              status: response.status(),
              body: await response.text().catch(() => '<closed>'),
            })
        })
        page.on('pageerror', (e) => errors.push({ name, width, mode, error: e.message }))
        page.on('console', (msg) => {
          if (msg.type() === 'error') {
            const text = msg.text()
            if (text.includes('net::ERR_FAILED')) warnings.push({ name, message: text })
            else errors.push({ name, width, mode, error: text, location: msg.location() })
          }
        })
        await page.goto('http://127.0.0.1:5173' + route)
        try {
          await page.getByText(expected, { exact: false }).first().waitFor()
          if (name === 'home' || name === 'community')
            await page.locator('.sponsored-ad-banner').waitFor({ timeout: 30000 })
          if (name === 'central' || name === 'metrics')
            await page
              .getByRole('heading', { name: 'Central de publicidade', exact: true })
              .waitFor()
          if (name === 'admin')
            await page
              .getByRole('button', { name: 'Confirmar pacote global', exact: true })
              .waitFor()
        } catch (e) {
          writeFileSync(
            '.finance-local/phase6-visual-failure.txt',
            page.url() + '\n' + (await page.locator('body').innerText())
          )
          throw e
        }
        await page.waitForLoadState('networkidle')
        await page.evaluate(
          (m) => document.documentElement.setAttribute('data-color-mode', m),
          mode
        )
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        )
        await page.screenshot({
          path: `docs/finance-restructure/phase6/evidence/${name}-${width}-${mode}.png`,
          fullPage: true,
        })
        checks.push({
          name,
          width,
          mode,
          overflow,
          banners: await page.locator('.sponsored-ad-banner').count(),
          cards: await page.locator('.sponsored-ad-card').count(),
        })
        assert.equal(overflow, false, `${name} ${width} ${mode} overflow`)
        // Drain real proxy requests before teardown; otherwise Playwright rejects
        // a pending protected-media fetch after disposing its request context.
        await context.unrouteAll({ behavior: 'wait' })
        await context.close()
      }
    }
  assert.equal(errors.length, 0, JSON.stringify(errors))
} finally {
  writeFileSync(
    'docs/finance-restructure/phase6/evidence/visual.json',
    JSON.stringify(
      {
        localOnly: true,
        officialRealtime: true,
        checks,
        errors,
        environmentWarnings: warnings,
        httpFailures,
      },
      null,
      2
    ) + '\n'
  )
  await browser.close()
}
console.log(JSON.stringify({ checks: checks.length, errors: errors.length }))

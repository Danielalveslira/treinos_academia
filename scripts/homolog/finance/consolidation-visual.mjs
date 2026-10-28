import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { advertisingContext } from './phase6-browser-context.mjs'
const a = JSON.parse(readFileSync('.finance-local/phase6-access.json'))
const story = JSON.parse(readFileSync('docs/finance-restructure/phase6/evidence/lifecycle.json'))
const evidence = 'docs/finance-restructure/consolidation/evidence'
mkdirSync(evidence, { recursive: true })
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE6_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const metricsOnly = process.argv[2] === '--metrics'
if (process.argv[2] && !metricsOnly) throw Error('Only --metrics is supported')
const checks = [],
  errors = [],
  httpFailures = []
try {
  for (const width of [320, 390, 1440])
    for (const mode of ['light', 'dark']) {
      for (const [name, route, session] of [
        ['wallet', '/evocash', a.owner],
        ['cash-admin', '/admin/compras-evocash', a.admin],
        ['commercial-admin', '/admin/parcerias?tab=engine', a.admin],
        ['advertising-admin', '/admin/parcerias?tab=autonomous', a.admin],
        ['products', '/vitrine', a.viewer],
        ['manage-products', '/vitrine/gerenciar', a.owner],
        ['professionals', '/profissionais', a.viewer],
        ['places', '/locais', a.viewer],
        ['manage-profiles', '/minha-vitrine', a.owner],
        ['advertising-metrics', '/meus-anuncios?accountId=' + story.account, a.owner],
        ['home', '/app', a.viewer],
        ['communities', '/comunidades', a.viewer],
        ['community', '/comunidades/' + story.community, a.viewer],
      ]) {
        if (metricsOnly && name !== 'advertising-metrics') continue
        const context = await advertisingContext(browser, session, width, mode)
        const page = await context.newPage()
        page.on('pageerror', (e) => errors.push({ name, width, mode, message: e.message }))
        page.on('response', (r) => {
          if (r.status() >= 400)
            httpFailures.push({
              name,
              width,
              mode,
              path: new URL(r.url()).pathname,
              status: r.status(),
            })
        })
        await page.goto('http://127.0.0.1:5173' + route)
        await page.waitForFunction(() => document.body.innerText.length > 50)
        if (metricsOnly)
          await page.getByText('Ambiente local de homologação.', { exact: false }).waitFor()
        await page.waitForLoadState('networkidle')
        await page.evaluate(
          (m) => document.documentElement.setAttribute('data-color-mode', m),
          mode
        )
        const result = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          textLength: document.body.innerText.length,
          route: location.pathname,
        }))
        checks.push({ name, width, mode, ...result })
        await page.screenshot({
          path: `${evidence}/visual-${name}-${width}-${mode}.png`,
          fullPage: true,
        })
        assert.equal(result.overflow, false, `${name} ${width} ${mode}: horizontal overflow`)
        assert.ok(result.textLength > 50, `${name}: content missing`)
        assert.ok(!/login|entrar/.test(result.route), `${name}: incorrect login redirect`)
        await context.close()
      }
    }
  assert.deepEqual(errors, [])
  assert.deepEqual(httpFailures, [])
} finally {
  writeFileSync(
    evidence + (metricsOnly ? '/visual-metrics.json' : '/visual.json'),
    JSON.stringify({ localOnly: true, checks, errors, httpFailures }, null, 2) + '\n'
  )
  await browser.close()
}
console.log('RESPONSIVE_ROUTES_PASS', checks.length)

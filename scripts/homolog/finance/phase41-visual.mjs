// Browser -> Auth/RPC/Edge/Storage/PostgreSQL. Only loopback and synthetic accounts.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
const access = JSON.parse(readFileSync('.finance-local/phase4-access.json', 'utf8'))
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PHASE4_CHROMIUM ||
    '/tmp/evolutus-phase3-browser/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const local = 'http://127.0.0.1:5173',
  evidence = 'docs/finance-restructure/phase4/evidence41'
mkdirSync(evidence, { recursive: true })
const errors = [],
  external = []
async function context(session) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  if (session)
    await ctx.addInitScript((s) => {
      if (location.origin === 'http://127.0.0.1:5173')
        localStorage.setItem(
          'sb-organic-goldfish-r7w5rp9g754vhxp4v-5173-auth-token',
          JSON.stringify(s)
        )
    }, session)
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (
      url.hostname === 'organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev' &&
      url.pathname.startsWith('/_finance_local/')
    ) {
      const response = await route.fetch({ url: local + url.pathname + url.search })
      if (response.status() >= 400)
        console.log('HTTP', response.status(), url.pathname, (await response.text()).slice(0, 300))
      return route.fulfill({ response })
    }
    if (
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.protocol === 'data:' ||
      url.protocol === 'blob:'
    )
      return route.continue()
    if (url.hostname !== 'va.vercel-scripts.com') external.push(url.origin)
    return route.abort()
  })
  ctx.on('page', (page) => page.on('pageerror', (e) => errors.push(e.message)))
  return ctx
}
const admin = await context(access.admin),
  page = await admin.newPage()
const results = []
try {
  for (const tab of ['commercial', 'engine']) {
    await page.goto(local + '/admin/parcerias?tab=' + tab)
    await page
      .getByRole('heading', {
        name: tab === 'commercial' ? 'Moderação de vitrines de produtos' : 'Motor comercial',
        exact: true,
      })
      .waitFor()
    for (const width of [320, 390, 1440])
      for (const mode of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme: mode })
        await page.evaluate((m) => {
          document.documentElement.setAttribute('data-color-mode', m)
          document.documentElement.setAttribute('data-dark-theme', 'dark')
          document.documentElement.setAttribute('data-light-theme', 'light')
        }, mode)
        await page.evaluate(() => window.scrollTo(0, 0))
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          tab + ' ' + width + ' ' + mode
        )
        await page.screenshot({
          path: `${evidence}/admin-${tab}-${width}-${mode}.png`,
          fullPage: true,
        })
        results.push({ tab, width, mode, overflow: false })
        if (tab === 'commercial') {
          await page.getByRole('button', { name: 'Configurar limpeza', exact: true }).click()
          const dialog = page.getByRole('dialog')
          await dialog.getByLabel('Tolerância em horas', { exact: true }).waitFor()
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false
          )
          await dialog.screenshot({ path: `${evidence}/cleanup-dialog-${width}-${mode}.png` })
          await page.keyboard.press('Escape')
          await dialog.waitFor({ state: 'hidden' })
        }
      }
  }
  assert.equal(errors.length, 0, errors.join('\n'))
  writeFileSync(
    evidence + '/admin-visual.json',
    JSON.stringify({ passed: true, results, consoleErrors: errors }, null, 2) + '\n'
  )
} finally {
  await browser.close()
}

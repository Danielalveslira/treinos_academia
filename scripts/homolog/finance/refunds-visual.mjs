import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
const access = JSON.parse(readFileSync('.finance-local/refunds/access.json')),
  base = 'http://127.0.0.1:5174'
const browser = await chromium.launch({
  executablePath:
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const checks = [],
  errors = []
try {
  for (const role of ['buyer', 'admin'])
    for (const width of [320, 390, 1440])
      for (const mode of ['light', 'dark']) {
        const c = await browser.newContext({
          viewport: { width, height: 1000 },
          colorScheme: mode,
          reducedMotion: 'reduce',
        })
        await c.addInitScript(
          ({ session, mode }) => {
            localStorage.setItem('sb-127-auth-token', JSON.stringify(session))
            localStorage.setItem('colorMode', mode)
          },
          { session: access[role].session, mode }
        )
        await c.route('**/*', (route) =>
          new URL(route.request().url()).origin === base ? route.continue() : route.abort()
        )
        const p = await c.newPage()
        p.on('pageerror', (e) => errors.push(e.message))
        await p.goto(base + (role === 'buyer' ? '/evocash' : '/admin/compras-evocash?tab=refunds'))
        if (role === 'buyer') {
          const open = p.getByRole('button', { name: 'Ver compra / Solicitar reembolso' }).first()
          await open.focus()
          await p.keyboard.press('Enter')
          await p
            .getByRole('dialog', { name: 'Cancelamento, reembolso ou problema' })
            .waitFor({ state: 'visible' })
          await p.getByLabel('Categoria', { exact: true }).waitFor()
          for (let i = 0; i < 12; i++) {
            await p.keyboard.press('Tab')
            assert.ok(
              await p.getByRole('dialog').evaluate((el) => el.contains(document.activeElement)),
              'focus escapes dialog'
            )
          }
          await p.screenshot({
            path: `.finance-local/refunds/captures/form-${width}-${mode}.png`,
            animations: 'disabled',
          })
          // Test modal Escape from a known button: native selects may consume
          // the first Escape while dismissing their own platform popup.
          await p.getByRole('button', { name: 'Fechar', exact: true }).focus()
          await p.keyboard.press('Escape')
          await p.getByRole('dialog').waitFor({ state: 'detached' })
          await p.waitForFunction(
            (el) => document.activeElement === el,
            await open.elementHandle(),
            { timeout: 3000 }
          )
        } else {
          await p.getByRole('button', { name: 'Ver solicitação', exact: true }).first().click()
          await p
            .getByRole('dialog', { name: 'Solicitação de reembolso' })
            .waitFor({ state: 'visible' })
          await p.screenshot({
            path: `.finance-local/refunds/captures/admin-${width}-${mode}.png`,
            animations: 'disabled',
          })
          assert.ok(
            await p.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
            'dialog overflow'
          )
          // Test modal Escape from a known button: native selects may consume
          // the first Escape while dismissing their own platform popup.
          await p.getByRole('button', { name: 'Fechar', exact: true }).focus()
          await p.keyboard.press('Escape')
          await p.getByRole('dialog').waitFor({ state: 'detached' })
        }
        assert.ok(
          await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          'page overflow'
        )
        checks.push({ role, width, mode, keyboardEscape: true, passed: true })
        await c.close()
      }
  assert.deepEqual(errors, [])
  writeFileSync(
    'docs/finance-restructure/refunds/evidence/visual-keyboard.json',
    JSON.stringify({ checks, errors, externalProviderCalls: 0 }, null, 2) + '\n'
  )
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors }))
} finally {
  await browser.close()
}

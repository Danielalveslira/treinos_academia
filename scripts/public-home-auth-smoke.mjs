import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { loadEnv } from 'vite'

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const env = loadEnv('production', process.cwd(), 'VITE_')
assert.ok(env.VITE_SUPABASE_URL, 'Supabase URL required for this browser test')
const ref = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]
const storageKey = `sb-${ref}-auth-token`
const user = { id: 'a0000000-0000-4000-8000-00000000000a', aud: 'authenticated', role: 'authenticated', email: 'test@example.com' }
const session = {
  access_token: 'browser-smoke-token',
  refresh_token: 'browser-smoke-refresh',
  token_type: 'bearer',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  user,
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox'],
})
try {
  for (const mode of ['absent', 'valid', 'invalid', 'expired']) {
    const context = await browser.newContext()
    if (mode !== 'absent') {
      await context.addInitScript(([key, value]) => {
        if (!sessionStorage.getItem('auth-smoke-seeded')) {
          localStorage.setItem(key, JSON.stringify(value))
          sessionStorage.setItem('auth-smoke-seeded', '1')
        }
      }, [storageKey, { ...session, ...(mode === 'expired' ? { expires_at: 1 } : {}) }])
    }
    const page = await context.newPage()
    const authAssets = []
    page.on('request', (request) => {
      if (request.url().includes('public-home-redirect.js')) authAssets.push(request.url())
    })
    await page.route('**/auth/v1/user**', (route) =>
      route.fulfill(mode === 'valid'
        ? { status: 200, contentType: 'application/json', body: JSON.stringify(user) }
        : { status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Invalid token' }) })
    )
    await page.route('**/auth/v1/token**', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Invalid refresh token' }) })
    )
    await page.goto(`${base}/`)
    if (mode === 'valid') {
      await page.waitForURL('**/app', { timeout: 10000 })
      assert.ok(authAssets.length > 0, 'a sessão válida carrega a checagem de autenticação')
      await page.goto(`${base}/como-funciona`)
      assert.equal(new URL(page.url()).pathname, '/como-funciona')
      assert.equal(await page.locator('h1').textContent(), 'Como funciona')
      await page.reload()
      assert.equal(new URL(page.url()).pathname, '/como-funciona')
      await page.locator('#public-header .public-header-brand').click()
      await page.waitForURL('**/app', { timeout: 10000 })
      await page.goto(`${base}/como-funciona`)
      await page.evaluate((key) => localStorage.removeItem(key), storageKey)
      await page.goto(`${base}/`)
      await page.locator('h1').waitFor({ state: 'visible' })
      assert.equal(new URL(page.url()).pathname, '/')
    } else {
      await page.locator('h1').waitFor({ state: 'visible', timeout: 10000 })
      assert.equal(new URL(page.url()).pathname, '/')
      assert.match(await page.locator('h1').textContent(), /Planeje, registre e acompanhe seus treinos\./)
      if (mode === 'absent') assert.equal(authAssets.length, 0, 'visitante não baixa o módulo de autenticação')
    }
    await context.close()
  }
  console.log('PUBLIC_HOME_AUTH_SMOKE_OK')
} finally {
  await browser.close()
}

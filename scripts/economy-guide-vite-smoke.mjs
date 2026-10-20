// Smoke do Vite real com sessão e respostas Supabase sintéticas. Não escreve no backend.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { loadEnv } from 'vite'
import manifest from '../legal/manifest.json' with { type: 'json' }
import documents from '../legal/documents.json' with { type: 'json' }
import digests from '../legal/approved-digests.json' with { type: 'json' }

const base = process.env.VITE_SMOKE_URL || 'http://127.0.0.1:5173'
const env = loadEnv('development', process.cwd(), 'VITE_')
assert.ok(env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL é necessário para o teste')
const ref = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]
const storageKey = `sb-${ref}-auth-token`
const uid = 'a0000000-0000-4000-8000-00000000000a'
const digest = digests[manifest.version]
const user = {
  id: uid,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'smoke@example.com',
  email_confirmed_at: '2026-10-01T12:00:00Z',
}
const session = {
  access_token: 'economy-guide-smoke-token',
  refresh_token: 'economy-guide-smoke-refresh',
  token_type: 'bearer',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  user,
}
const profile = {
  id: uid,
  role: 'user',
  username: 'smoke_economy',
  created_at: '2026-10-01T12:00:00Z',
  sexo: 'nao_informar',
  data_nascimento: '1990-01-01',
  usage_profile: 'common',
  account_status: 'active',
  legal_acceptance_version: manifest.version,
  legal_acceptance_digest: digest,
  legal_acceptance_accepted_at: '2026-10-02T12:00:00Z',
}

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox'],
})

try {
  for (const width of [320, 375, 390, 768, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      serviceWorkers: 'block',
    })
    await context.addInitScript(
      ([key, value]) => {
        localStorage.setItem(key, JSON.stringify(value))
        localStorage.setItem('colorMode', 'dark')
      },
      [storageKey, session]
    )
    await context.route(`${env.VITE_SUPABASE_URL}/**`, async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      const headers = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,prefer',
        'content-type': 'application/json',
      }
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      let data = null
      if (path === '/auth/v1/user') data = user
      else if (path.endsWith('/rpc/ensure_user_profile')) data = profile
      else if (path.endsWith('/rpc/has_app_access')) data = true
      else if (path.endsWith('/rpc/get_my_wallet'))
        data = { coin_balance: 12, lifetime_coins_earned: 20, cash_balance: 5 }
      else if (path.endsWith('/rpc/get_my_evocoin_day')) data = { dailyEarned: 2, dailyLimit: 10 }
      else if (path.endsWith('/legal_policy'))
        data = {
          version: manifest.version,
          published: true,
          digest,
          published_at: '2026-10-01T12:00:00Z',
        }
      else if (path.endsWith('/legal_versions')) data = { manifest, documents, digest }
      else if (path.endsWith('/economy_transactions'))
        data = Array.from({ length: 12 }, (_, index) => ({
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          asset: index % 2 ? 'cash' : 'coin',
          direction: index % 2 ? 'debit' : 'credit',
          amount: index + 1,
          reason: index % 2 ? 'promotion_purchase' : 'workout_completed',
          created_at: new Date(Date.UTC(2026, 9, 20 - index, 12)).toISOString(),
        }))
      else if (request.method() === 'GET') data = []
      await route.fulfill({ status: 200, headers, body: JSON.stringify(data) })
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const response = await page.goto(`${base}/entenda-suas-moedas`, {
      waitUntil: 'domcontentloaded',
    })
    assert.equal(response.status(), 200)
    await page.getByRole('heading', { name: 'Entenda suas moedas' }).waitFor({ timeout: 20000 })
    assert.equal(await page.getByRole('heading', { name: 'EvoCoins', exact: true }).count(), 1)
    assert.equal(await page.getByRole('heading', { name: 'EvoCash', exact: true }).count(), 1)
    assert.match(await page.locator('.economy-guide-balances').textContent(), /12.*5/s)
    assert.equal(await page.locator('.economy-guide-card-heading .brand-mark-svg').count(), 2)
    assert.equal(await page.locator('.economy-guide-steps li').count(), 3)
    await page.getByRole('button', { name: 'Ver movimentações' }).click()
    await page.getByText('Treino concluído').first().waitFor()
    assert.equal(await page.locator('.economy-guide-history li').count(), 5)
    assert.equal(await page.locator('.economy-guide-transaction-credit').count(), 3)
    assert.equal(await page.locator('.economy-guide-transaction-debit').count(), 2)
    if (process.env.ECONOMY_GUIDE_SCREENSHOTS && [320, 390, 1440].includes(width)) {
      await page.screenshot({ path: `/tmp/economy-guide-${width}.png`, fullPage: true })
    }
    await page.getByRole('button', { name: 'Ver mais 7 movimentações' }).click()
    assert.equal(await page.locator('.economy-guide-history li').count(), 12)
    await page.getByRole('button', { name: 'Mostrar menos' }).click()
    assert.equal(await page.locator('.economy-guide-history li').count(), 5)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Entenda suas moedas' }).waitFor({ timeout: 20000 })
    await page.getByRole('link', { name: 'Ver minha carteira' }).click()
    await page.waitForURL('**/perfil')
    await page.locator('.wallet-header-badges').click()
    await page.waitForURL('**/entenda-suas-moedas')
    await page.getByRole('heading', { name: 'Entenda suas moedas' }).waitFor()
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `overflow em ${width}px`
    )
    assert.deepEqual(errors, [], `erros de página em ${width}px`)
    await context.close()
  }
  console.log('ECONOMY_GUIDE_VITE_OK: URL direta, F5, carteira → central, desktop e mobile')
} finally {
  await browser.close()
}

// Tests the frontend before/after the expiry fix, intercepting Supabase HTTP/Realtime with
// synthetic fixtures. No production account, credential or database write is used.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
const origin = process.argv[2] || 'https://treinosacademia-ten.vercel.app'
assert.ok(
  /^https:\/\/treinosacademia-[a-z0-9-]+\.vercel\.app$|^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
)
const dir = `/tmp/evolutus-recent-feed/${origin.startsWith('http:') ? 'local' : 'production'}`
await mkdir(dir, { recursive: true })
const uid = '44444444-4444-4444-8444-444444444444'
const statusId = '11111111-1111-4111-8111-111111111111'
const communityId = '22222222-2222-4222-8222-222222222222'
const commentId = '33333333-3333-4333-8333-333333333333'
const text = 'Promoção vigente com retenção expirada'
const status = {
  id: statusId,
  community_id: communityId,
  author_id: uid,
  author_username: 'autor',
  type: 'text',
  text,
  created_at: '2026-10-13T12:00:00Z',
  expires_at: '2000-01-01T00:00:00Z',
  retention_mode: '24h',
  interaction_expires_at: '2099-01-01T00:00:00Z',
  publication_expires_at: '2099-01-01T00:00:00Z',
  verified_promoted_until: '2099-01-01T00:00:00Z',
  comment_count: 2,
}
const manifest = JSON.parse(await readFile('legal/manifest.json', 'utf8'))
const documents = JSON.parse(await readFile('legal/documents.json', 'utf8'))
const digests = JSON.parse(await readFile('legal/approved-digests.json', 'utf8'))
const digest = digests[manifest.version]
const policy = { version: manifest.version, digest, published: true }
const user = {
  id: uid,
  email: 'fixture@example.invalid',
  aud: 'authenticated',
  role: 'authenticated',
  email_confirmed_at: '2026-10-01T00:00:00Z',
  user_metadata: {},
  app_metadata: { provider: 'email', providers: ['email'] },
  created_at: '2026-10-01T00:00:00Z',
}
const profile = {
  id: uid,
  username: 'fixture',
  role: 'member',
  account_status: 'active',
  created_at: '2026-10-01T00:00:00Z',
  legal_acceptance_version: manifest.version,
  legal_acceptance_digest: digest,
  legal_acceptance_accepted_at: '2026-10-01T00:00:00Z',
}
const results = []
const mode = process.argv[3] || 'after'
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
try {
  for (const width of [390, 1366]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      serviceWorkers: 'block',
    })
    let promotionActive = true
    let recentQueries = 0
    await context.route('https://*.supabase.co/**', async (route) => {
      const url = new URL(route.request().url())
      const name = url.pathname.split('/').at(-1)
      let data = []
      if (url.pathname.includes('/auth/v1/user')) data = user
      else if (name === 'ensure_user_profile') data = profile
      else if (name === 'has_app_access') data = true
      else if (name === 'get_community_access') data = 'member'
      else if (name === 'legal_policy') data = [policy]
      else if (name === 'legal_versions') data = [{ manifest, documents, digest }]
      else if (name === 'users') data = [profile]
      else if (name === 'status_publications') {
        if (url.searchParams.has('workout_date')) data = []
        else if (url.searchParams.has('verified_promoted_until'))
          data = promotionActive ? [status] : []
        else {
          recentQueries++
          assert.match(url.searchParams.get('or'), /publication_expires_at/)
          data = [
            ...(promotionActive ? [status] : []),
            {
              ...status,
              id: commentId,
              text: 'Publicação comum',
              expires_at: '2099-01-01T00:00:00Z',
              verified_promoted_until: null,
            },
            {
              ...status,
              id: '55555555-5555-4555-8555-555555555555',
              text: 'Publicação permanente',
              expires_at: null,
              publication_expires_at: null,
              retention_mode: 'no_auto_expiration',
              verified_promoted_until: null,
            },
          ]
        }
      } else if (name === 'communities')
        data = [
          {
            id: communityId,
            name: 'Comunidade de teste',
            is_active: true,
            post_access: 'everyone',
            post_retention_mode: '24h',
          },
        ]
      else if (name === 'wallets') data = [{ user_id: uid, coins_balance: 0, cash_balance: 0 }]
      else if (name.includes('unread')) data = 0
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(data),
      })
    })
    await context.routeWebSocket('**/realtime/**', (socket) => socket.close())
    await context.addInitScript(
      ({ uid, user }) => {
        const exp = Math.floor(Date.now() / 1000) + 3600
        const access_token =
          btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) +
          '.' +
          btoa(JSON.stringify({ sub: uid, role: 'authenticated', exp })) +
          '.fixture-unsigned'
        localStorage.setItem(
          'sb-ywrjojrjgozdfpddkkuy-auth-token',
          JSON.stringify({
            access_token,
            refresh_token: 'fixture-only',
            expires_at: exp,
            expires_in: 3600,
            token_type: 'bearer',
            user,
          })
        )
      },
      { uid, user }
    )
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(origin + `/comunidades/${communityId}`)
    const recent = page.locator('#cd-feed-panel-recent')
    const post = recent.locator(`[id="publicacao-${statusId}"]`)
    await post.waitFor({ timeout: 30000 })
    await page.screenshot({ path: resolve(dir, `${mode}-${width}-initial.png`) })
    await page.waitForTimeout(16500)
    const count = await post.count()
    assert.equal(count, mode === 'before' ? 0 : 1)
    await page.screenshot({ path: resolve(dir, `${mode}-${width}-tick.png`) })
    const queriesBeforeTabs = recentQueries
    await page.getByRole('tab', { name: /Destaques/ }).click()
    await page.getByText('Promoção vigente com retenção expirada', { exact: true }).last().waitFor()
    await page.getByRole('tab', { name: 'Recentes', exact: true }).click()
    assert.equal(await post.count(), mode === 'before' ? 0 : 1)
    assert.equal(recentQueries, queriesBeforeTabs, 'trocar abas não deve consultar Recentes')
    if (mode !== 'before') {
      await page.getByRole('button', { name: 'Mais ações da comunidade' }).click()
      await page.getByRole('menuitem', { name: 'Atualizar publicações' }).click()
      await page.waitForTimeout(1000)
      assert.equal(await post.count(), 1)
      const queriesBeforeReopen = recentQueries
      // Navegação SPA: reutiliza a cache de sessão do hook.
      await page.evaluate(() => {
        history.pushState({}, '', '/')
        dispatchEvent(new PopStateEvent('popstate'))
      })
      await page.waitForTimeout(300)
      await page.evaluate((path) => {
        history.pushState({}, '', path)
        dispatchEvent(new PopStateEvent('popstate'))
      }, `/comunidades/${communityId}`)
      await post.waitFor()
      assert.equal(await post.count(), 1)
      assert.equal(recentQueries, queriesBeforeReopen, 'reabrir com cache fresco não consulta feed')
      await page.reload()
      await post.waitFor()
      await page.waitForTimeout(16500)
      assert.equal(await post.count(), 1)
      assert.equal(await recent.getByText('Publicação comum', { exact: true }).count(), 1)
      assert.equal(await recent.getByText('Publicação permanente', { exact: true }).count(), 1)
      // Cancelamento/encerramento: nova resposta da view não inclui o post vencido.
      promotionActive = false
      await page.getByRole('button', { name: 'Mais ações da comunidade' }).click()
      await page.getByRole('menuitem', { name: 'Atualizar publicações' }).click()
      await post.waitFor({ state: 'detached' })
      assert.equal(await recent.getByText('Publicação comum', { exact: true }).count(), 1)
      assert.equal(await recent.getByText('Publicação permanente', { exact: true }).count(), 1)
      await page.getByRole('tab', { name: /Destaques/ }).click()
      assert.equal(
        await page.locator('#cd-feed-panel-featured [id^="destaque-publicacao-"]').count(),
        0
      )
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    assert.deepEqual(errors, [])
    results.push({ width, afterTick: count, recentQueries, errors })
    await context.close()
  }
  await writeFile(
    resolve(dir, `${mode}-results.json`),
    JSON.stringify({ origin, mode, fixturesOnly: true, results }, null, 2)
  )
  console.log(JSON.stringify({ origin, mode, fixturesOnly: true, results, screenshots: dir }))
} finally {
  await browser.close()
}

// Loads the published frontend, while intercepting all Supabase HTTP/Realtime with
// synthetic fixtures. No production account, credential or database write is used.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
const origin = process.argv[2] || 'https://treinosacademia-ten.vercel.app'
assert.ok(
  /^https:\/\/treinosacademia-[a-z0-9-]+\.vercel\.app$|^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
)
const dir = '/tmp/evolutus-push-layout/production'
await mkdir(dir, { recursive: true })
const uid = '44444444-4444-4444-8444-444444444444'
const statusId = '11111111-1111-4111-8111-111111111111'
const communityId = '22222222-2222-4222-8222-222222222222'
const commentId = '33333333-3333-4333-8333-333333333333'
const token = 'semquebra'.repeat(60)
const text =
  '# Publicação extensa\n\n' +
  Array.from(
    { length: 6 },
    (_, i) => `## Seção ${i + 1}\n\nTexto extenso da publicação.\n\n- Lista\n- ${token}\n\n`
  ).join('') +
  '| Exercício | Descrição | Séries | Carga | Observação |\n| --- | --- | --- | --- | --- |\n| Agachamento | ' +
  token +
  ' | 4 | 80kg | Completo |'
assert.ok(text.length < 7000)
const status = {
  id: statusId,
  community_id: communityId,
  author_id: uid,
  author_username: 'autor',
  type: 'text',
  text,
  created_at: '2026-10-13T12:00:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  retention_mode: '24h',
  interaction_expires_at: '2099-01-01T00:00:00Z',
  publication_expires_at: '2099-01-01T00:00:00Z',
  verified_promoted_until: null,
  comment_count: 2,
}
const comments = [0, 1].map((i) => ({
  id: i ? commentId : 'ancestor',
  statusId,
  authorId: uid,
  authorUsername: 'autor',
  createdAt: '2026-10-13T12:00:00Z',
  status: 'active',
  body: ('Comentário extenso ' + token + '\n').repeat(2),
  replyCount: 0,
  likeCount: 1,
  depth: i,
}))
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
const path = `/comunidades/${communityId}/publicacoes/${statusId}/comentarios/${commentId}`
const results = []
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
try {
  for (const width of [320, 360, 390, 430])
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        serviceWorkers: 'block',
      })
      await context.route('https://*.supabase.co/**', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const name = url.pathname.split('/').at(-1)
        let data = []
        if (url.pathname.includes('/auth/v1/user')) data = user
        else if (name === 'ensure_user_profile') data = profile
        else if (name === 'has_app_access') data = true
        else if (name === 'legal_policy') data = [policy]
        else if (name === 'legal_versions') data = [{ manifest, documents, digest }]
        else if (name === 'users') data = [profile]
        else if (name === 'comment_context') data = { statusId, communityId, comments }
        else if (name === 'status_publications') data = [status]
        else if (name === 'communities')
          data = [
            {
              id: communityId,
              name: 'Comunidade de teste',
              owner_id: uid,
              is_active: true,
              post_access: 'everyone',
            },
          ]
        else if (name === 'wallets')
          data = [{ user_id: uid, coins_balance: 0, cash_balance: 0, lifetime_coins_earned: 0 }]
        else if (name.includes('unread')) data = 0
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(data),
        })
      })
      await context.routeWebSocket('**/realtime/**', (socket) => socket.close())
      await context.addInitScript(
        ({ uid, user, dark }) => {
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
          localStorage.setItem('colorMode', dark ? 'night' : 'day')
        },
        { uid, user, dark }
      )
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      const response = await page.goto(origin + path, { waitUntil: 'domcontentloaded' })
      assert.equal(response.status(), 200)
      await page.locator('.comment-card.is-highlighted').waitFor({ timeout: 30000 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
      const target = await page.locator('.comment-card.is-highlighted').boundingBox()
      const header = await page.locator('.app-header').boundingBox()
      assert.ok(target.y >= header.y + header.height - 1 && target.y < 760)
      await page.screenshot({
        path: resolve(dir, `${width}-${dark ? 'dark' : 'light'}-target.png`),
      })
      await page.locator('.comment-publication-summary').scrollIntoViewIfNeeded()
      await page.getByRole('button', { name: 'Ver mais', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Ver mais', exact: true }).click()
      await page.locator('[role="region"][aria-label="Tabela"]').waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
      const table = await page
        .locator('[role="region"][aria-label="Tabela"]')
        .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }))
      assert.ok(table.width < width && table.scroll > table.width)
      await page.screenshot({ path: resolve(dir, `${width}-${dark ? 'dark' : 'light'}-table.png`) })
      await page.getByRole('button', { name: 'Ver menos', exact: true }).click()
      await page.getByRole('button', { name: 'Ver mais', exact: true }).waitFor()
      assert.deepEqual(errors, [])
      results.push({
        width,
        dark,
        http: response.status(),
        targetTop: target.y,
        headerBottom: header.y + header.height,
        table,
        pageErrors: errors,
      })
      await context.close()
    }
  await writeFile(
    resolve(dir, 'results.json'),
    JSON.stringify({ origin, fixturesOnly: true, results }, null, 2)
  )
  console.log(
    JSON.stringify({ origin, fixturesOnly: true, cases: results.length, screenshots: dir, results })
  )
} finally {
  await browser.close()
}

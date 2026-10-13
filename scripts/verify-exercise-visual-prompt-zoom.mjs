import { ensureVisualTestFixtures } from './exercise-visual-test-fixtures.mjs'
// Local-only prompt and zoom regression. Every Supabase request is intercepted; no backend writes.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const origin = process.argv[2] || 'http://127.0.0.1:55446'
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/)
const mode = process.argv[3] || 'after'
const dir = `/tmp/exercise-prompt-zoom/${mode}`
await mkdir(dir, { recursive: true })
const uid = '44444444-4444-4444-8444-444444444444',
  cat = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ids = [1, 2, 3, 4].map((n) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`)
const catalog = JSON.parse(await readFile('imports/exercicios_ptbr.json', 'utf8'))
const sample = catalog.find((ex) => ex.id === 'Alternate_Hammer_Curl')
const exercise = {
  ...sample,
  id: cat,
  primary_muscle: 'biceps',
  published_media_refs: { version: 1, images: [] },
  is_active: true,
}
const manifest = JSON.parse(await readFile('legal/manifest.json', 'utf8')),
  documents = JSON.parse(await readFile('legal/documents.json', 'utf8')),
  digest = JSON.parse(await readFile('legal/approved-digests.json', 'utf8'))[manifest.version]
const user = {
  id: uid,
  email: 'visual-fixture@example.invalid',
  aud: 'authenticated',
  role: 'authenticated',
  email_confirmed_at: '2026-10-01T00:00:00Z',
  user_metadata: {},
  app_metadata: { provider: 'email', providers: ['email'] },
  created_at: '2026-10-01T00:00:00Z',
}
const profile = {
  id: uid,
  username: 'visualreviewer',
  role: 'superadmin',
  account_status: 'active',
  created_at: '2026-10-01T00:00:00Z',
  legal_acceptance_version: manifest.version,
  legal_acceptance_digest: digest,
  legal_acceptance_accepted_at: '2026-10-01T00:00:00Z',
}
const style = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  name: 'EVOLUTUS_FITNESS_V2',
  version: 'v2',
  base_prompt:
    'Ilustração técnica fitness 3D semi-realista.\nEquipamento proporcional ao corpo, realista e com acabamento consistente.',
  negative_rules: 'Sem texto.\nSem membros extras.',
}
await ensureVisualTestFixtures()
const bytes = Object.fromEntries(
  await Promise.all(
    ['start', 'end', 'thumb', 'landscape'].map(async (role) => [
      role,
      await readFile(`/tmp/exercise-visual-fixtures/${role}.webp`),
    ])
  )
)
function visual(n, status) {
  const published = ['published', 'archived'].includes(status)
  return {
    id: ids[n - 1],
    catalog_id: cat,
    version: n,
    status,
    generation_source: 'manual_upload',
    style_version: 'v2',
    prompt_version: 'v2.1',
    created_at: '2026-10-13T12:00:00Z',
    published_at: published ? '2026-10-13T12:00:00Z' : null,
    metadata: {},
    assets: ['start', 'end', 'thumbnail'].map((role) => ({
      role,
      storage_bucket: published ? 'exercise-visuals' : 'exercise-visual-drafts',
      storage_path: `${cat}/${published ? `v${n}` : ids[n - 1]}/${role === 'thumbnail' ? 'thumb' : role}.webp`,
      mime_type: 'image/webp',
      width: role === 'thumbnail' ? 320 : 1024,
      height: role === 'thumbnail' ? 320 : 1024,
      byte_size: bytes[role === 'thumbnail' ? 'thumb' : role].length,
    })),
  }
}
const results = []
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
try {
  for (const width of [320, 390, 768, 1366])
    for (const dark of [false, true])
      for (const incomplete of [false, true]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          serviceWorkers: 'block',
          permissions: ['clipboard-read', 'clipboard-write'],
        })
        const fixture = {
          ...exercise,
          ...(incomplete
            ? { instructions: ['Mantenha o tronco estável e contraia o bíceps.'] }
            : {}),
        }
        let requests = 0
        await context.route('https://*.supabase.co/**', async (route) => {
          const req = route.request(),
            url = new URL(req.url()),
            name = url.pathname.split('/').at(-1)
          if (
            /\/rest\/v1\/exercise_/.test(url.pathname) ||
            (url.pathname.includes('/storage/v1/object/sign/') && req.method() !== 'GET')
          )
            requests++
          if (url.pathname.includes('/storage/v1/object/') && req.method() === 'GET')
            return route.fulfill({
              status: 200,
              contentType: 'image/webp',
              body: bytes[name.split('.')[0]] || bytes.start,
            })
          let data = []
          if (url.pathname.includes('/auth/v1/user')) data = user
          else if (name === 'ensure_user_profile') data = profile
          else if (name === 'has_app_access') data = true
          else if (name === 'legal_policy')
            data = [{ version: manifest.version, digest, published: true }]
          else if (name === 'legal_versions') data = [{ manifest, documents, digest }]
          else if (name === 'users') data = [profile]
          else if (name === 'exercise_catalog') data = [fixture]
          else if (name === 'exercise_visual_style_profiles') data = [style]
          else if (name === 'exercise_visual_sets')
            data = [visual(3, 'review'), visual(1, 'published')]
          else if (url.pathname.includes('/storage/v1/object/sign/'))
            data = req.postDataJSON().paths.map((path) => ({
              path,
              signedURL: `/object/sign/exercise-visual-drafts/${path}?token=fixture`,
            }))
          else if (name === 'wallets') data = [{ user_id: uid, coins_balance: 0, cash_balance: 0 }]
          else if (name.includes('unread')) data = 0
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: {
              'Content-Range': '0-0/1',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Expose-Headers': 'Content-Range',
            },
            body: JSON.stringify(data),
          })
        })
        await context.routeWebSocket('**/realtime/**', (socket) => socket.close())
        await context.addInitScript(
          ({ uid, user, dark }) => {
            const exp = Math.floor(Date.now() / 1000) + 3600
            const token =
              btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) +
              '.' +
              btoa(JSON.stringify({ sub: uid, role: 'authenticated', exp })) +
              '.fixture'
            localStorage.setItem(
              'sb-ywrjojrjgozdfpddkkuy-auth-token',
              JSON.stringify({
                access_token: token,
                refresh_token: 'fixture',
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
        const page = await context.newPage(),
          errors = [],
          consoleErrors = []
        page.on('pageerror', (e) => errors.push(e.message))
        page.on('console', (m) => {
          if (m.type() === 'error') consoleErrors.push(m.text())
        })
        assert.equal(
          (
            await page.goto(origin + '/admin/exercicios-imagens', { waitUntil: 'domcontentloaded' })
          ).status(),
          200
        )
        await page.locator('.exercise-visuals-row').first().click()
        const review = page.locator('.ev-review-card')
        await review.waitFor()
        const start = page.getByRole('button', { name: 'Copiar prompt INICIAL', exact: true }),
          end = page.getByRole('button', { name: 'Copiar prompt FINAL', exact: true })
        const tag = `${width}-${dark ? 'dark' : 'light'}-${incomplete ? 'incomplete' : 'complete'}`
        await page.locator('.ev-detail > .ev-preview').scrollIntoViewIfNeeded()
        await page.waitForFunction(() =>
          Array.from(document.querySelectorAll('.ev-detail > .ev-preview img')).every(
            (img) => img.complete && img.naturalWidth > 0
          )
        )
        await start.evaluate((el) => el.scrollIntoView({ block: 'center' }))
        await page.screenshot({ animations: 'disabled', path: `${dir}/${tag}-prompts.png` })
        const promptState = {
          startEnabled: await start.isEnabled(),
          endEnabled: await end.isEnabled(),
        }
        if (mode === 'after') {
          assert.deepEqual(promptState, { startEnabled: true, endEnabled: true })
          await start.click()
          const initial = await page.evaluate(() => navigator.clipboard.readText())
          assert.match(initial, /POSIÇÃO INICIAL \(START\)/)
          await end.click()
          const final = await page.evaluate(() => navigator.clipboard.readText())
          assert.match(final, /REFERÊNCIA OBRIGATÓRIA/)
          assert.match(final, /Se a imagem START não estiver disponível, avise/)
          if (incomplete) {
            await page
              .getByText('Instruções incompletas. Confira a execução antes de gerar.', {
                exact: true,
              })
              .waitFor()
            assert.match(initial, /Mantenha o tronco estável e contraia o bíceps/)
            assert.match(final, /CONFIRA ANTES DE GERAR/)
          }
        }
        await review.scrollIntoViewIfNeeded()
        await page.waitForFunction(() =>
          Array.from(document.querySelectorAll('.ev-review-card img')).every(
            (img) => img.complete && img.naturalWidth > 0
          )
        )
        const trigger = review.getByRole('button', { name: /Ampliar Início/ })
        const scrollBefore = await page.evaluate(() => window.scrollY),
          readsBefore = requests
        await trigger.click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        await dialog.locator('img').evaluate((img) => img.decode())
        await dialog.evaluate((el) =>
          Promise.all(
            el.parentElement.getAnimations({ subtree: true }).map((animation) => animation.finished)
          )
        )
        const geometry = await dialog.evaluate((el) => {
          const r = el.getBoundingClientRect(),
            image = el.querySelector('img').getBoundingClientRect()
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            image: { x: image.x, y: image.y, width: image.width, height: image.height },
            viewport: { width: innerWidth, height: innerHeight },
            scrollWidth: document.documentElement.scrollWidth,
            objectFit: getComputedStyle(el.querySelector('img')).objectFit,
          }
        })
        await page.screenshot({ animations: 'disabled', path: `${dir}/${tag}-zoom.png` })
        if (mode === 'after') {
          assert.ok(geometry.x >= 16 && geometry.x + geometry.width <= width - 16)
          assert.ok(
            geometry.y >= 80 && geometry.y + geometry.height <= 900 - (width < 768 ? 92 : 16)
          )
          assert.equal(geometry.objectFit, 'contain')
          assert.equal(geometry.scrollWidth, width)
          assert.ok(
            geometry.image.x >= geometry.x &&
              geometry.image.x + geometry.image.width <= geometry.x + geometry.width + 1
          )
          assert.ok(geometry.image.y + geometry.image.height <= geometry.y + geometry.height + 1)
          await page.setViewportSize({ width, height: 420 })
          const compact = await dialog.boundingBox()
          assert.ok(
            compact.y >= 80 && compact.y + compact.height <= 420 - (width < 768 ? 92 : 16),
            'short viewport keeps header and navigation clear'
          )
          await page.setViewportSize({ width, height: 900 })
          await page.mouse.wheel(0, 400)
          assert.equal(
            await page.evaluate(() => window.scrollY),
            scrollBefore,
            'background stays locked'
          )
        }
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
        if (mode === 'after')
          assert.equal(
            await trigger.evaluate((el) => el === document.activeElement),
            true,
            'focus returns to opener'
          )
        await trigger.click()
        await page
          .getByRole('dialog')
          .getByRole('button', { name: /close|fechar/i })
          .click()
        await dialog.waitFor({ state: 'detached' })
        if (mode === 'after')
          assert.equal(requests, readsBefore, 'zoom reuses image and performs no extra queries')
        assert.deepEqual(errors, [])
        assert.deepEqual(consoleErrors, [])
        results.push({ width, dark, incomplete, promptState, geometry, errors, consoleErrors })
        await context.close()
      }
  await writeFile(
    `${dir}/results.json`,
    JSON.stringify({ origin, mode, localOnly: true, results }, null, 2)
  )
  console.log(JSON.stringify({ mode, cases: results.length, screenshots: dir }))
} finally {
  await browser.close()
}

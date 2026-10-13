import { ensureVisualTestFixtures } from './exercise-visual-test-fixtures.mjs'
// Local-only frontend smoke. Synthetic fixtures intercept every Supabase request; no production write.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const origin = process.argv[2] || 'http://127.0.0.1:55446'
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/)
const mode = process.argv[3] || 'after'
const dir = `/tmp/exercise-visual-tests/browser-${mode}`
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
  for (const width of [390, 1366])
    for (const dark of [false, true]) {
      let currentExercise = { ...exercise }
      let sets = [visual(3, 'review'), visual(2, 'archived'), visual(1, 'published')],
        jobs = [],
        storageDown = true
      const calls = []
      let signedRequests = 0,
        documentRequests = 0
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        serviceWorkers: 'block',
      })
      await context.route('https://*.supabase.co/**', async (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          name = url.pathname.split('/').at(-1)
        calls.push({ name, method: request.method() })
        const body = request.headers()['content-type']?.includes('application/json')
          ? request.postDataJSON()
          : null
        if (url.pathname.includes('/storage/v1/object/') && request.method() === 'GET') {
          const role = name.split('.')[0]
          const file = url.pathname.includes(ids[3]) && role === 'end' ? 'landscape' : role
          return route.fulfill({
            status: 200,
            contentType: 'image/webp',
            body: bytes[file] || bytes.start,
          })
        }
        let data = []
        if (url.pathname.includes('/auth/v1/user')) data = user
        else if (name === 'ensure_user_profile') data = profile
        else if (name === 'has_app_access') data = true
        else if (name === 'legal_policy')
          data = [{ version: manifest.version, digest, published: true }]
        else if (name === 'legal_versions') data = [{ manifest, documents, digest }]
        else if (name === 'users') data = [profile]
        else if (name === 'exercise_catalog') data = [currentExercise]
        else if (name === 'exercise_visual_style_profiles') data = [style]
        else if (name === 'exercise_visual_sets')
          data = sets.filter(
            (s) => !url.searchParams.has('status') || ['review', 'published'].includes(s.status)
          )
        else if (name === 'exercise_visual_deletions')
          data = jobs.filter((j) => !url.searchParams.has('status') || j.status !== 'complete')
        else if (url.pathname.includes('/storage/v1/object/sign/')) {
          signedRequests++
          data = body.paths.map((path) => ({
            path,
            signedURL: `/object/sign/exercise-visual-drafts/${path}?token=fixture`,
          }))
        } else if (name === 'publish-exercise-visual') {
          sets = sets.map((s) =>
            s.id === body.visualSetId
              ? visual(s.version, 'published')
              : s.status === 'published'
                ? visual(s.version, 'archived')
                : s
          )
          data = { visualSetId: body.visualSetId, publishedMediaRefs: { version: 3, images: [] } }
        } else if (name === 'allocate_exercise_visual_set')
          data = {
            visualSetId: ids[3],
            version: 4,
            status: 'allocated',
            assets: Object.fromEntries(
              visual(4, 'allocated').assets.map((a) => [a.role, { path: a.storage_path }])
            ),
          }
        else if (name === 'exercise-visual-confirm') {
          sets = [visual(4, 'review'), ...sets]
          data = { visualSetId: ids[3], status: 'review' }
        } else if (name === 'reject_exercise_visual_set') {
          sets = sets.map((s) =>
            s.id === body.p_set_id
              ? { ...s, status: 'rejected', metadata: { rejection: { reason: body.p_reason } } }
              : s
          )
          data = { status: 'rejected' }
        } else if (name === 'request_exercise_visual_deletion') {
          sets = sets.filter((s) => s.id !== body.p_set_id)
          jobs = [{ visual_set_id: body.p_set_id, version: 4, status: 'pending' }]
          data = { status: 'pending' }
        } else if (name === 'delete-exercise-visual') {
          if (storageDown) {
            storageDown = false
            return route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'DELETION_PENDING' }),
            })
          }
          jobs = jobs.map((j) => ({ ...j, status: 'complete' }))
          data = { status: 'complete', complete: true }
        } else if (name === 'wallets') data = [{ user_id: uid, coins_balance: 0, cash_balance: 0 }]
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
          const exp = Math.floor(Date.now() / 1000) + 3600,
            access_token =
              btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) +
              '.' +
              btoa(JSON.stringify({ sub: uid, role: 'authenticated', exp })) +
              '.fixture'
          localStorage.setItem(
            'sb-ywrjojrjgozdfpddkkuy-auth-token',
            JSON.stringify({
              access_token,
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
        errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('request', (req) => {
        if (req.isNavigationRequest() && req.resourceType() === 'document') documentRequests++
      })
      const response = await page.goto(origin + '/admin/exercicios-imagens', {
        waitUntil: 'domcontentloaded',
      })
      assert.equal(response.status(), 200)
      await page.locator('.exercise-visuals-row').first().waitFor()
      await page.locator('.exercise-visuals-row').first().click()
      const review = page.locator('.ev-review-card')
      await review.waitFor()
      await review.scrollIntoViewIfNeeded()
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('.ev-review-card img')).every(
          (img) => img.complete && img.naturalWidth > 0
        )
      )
      await page.evaluate(async () => {
        await Promise.all(
          Array.from(document.querySelectorAll('.ev-review-card img')).map((img) => img.decode())
        )
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
      const images = await review.locator('img').evaluateAll((imgs) =>
        imgs.map((img) => ({
          width: img.naturalWidth,
          height: img.naturalHeight,
          complete: img.complete,
          loading: img.loading,
        }))
      )
      assert.equal(images.length, 3)
      await page.screenshot({ path: `${dir}/${width}-${dark ? 'dark' : 'light'}-review.png` })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
      if (mode === 'before') assert.equal(await review.getByRole('checkbox').count(), 10)
      else {
        assert.equal(await review.getByRole('checkbox').count(), 1)
        assert.equal(
          await page.getByRole('button', { name: 'Copiar prompt FINAL', exact: true }).isDisabled(),
          true
        )
        await page.getByRole('checkbox', { name: /Já tenho a imagem START/ }).check()
        assert.equal(
          await page.getByRole('button', { name: 'Copiar prompt FINAL', exact: true }).isEnabled(),
          true
        )
        const requestsBeforeHistory = signedRequests
        await page.locator('.ev-history summary').click()
        await page.getByText('Versão 2', { exact: true }).waitFor()
        assert.equal(
          signedRequests,
          requestsBeforeHistory,
          'public archived history does not sign/download full draft images again'
        )
        await page.locator('.ev-history summary').click()
        await review.getByRole('button', { name: /Ampliar Início/ }).click()
        await page.getByRole('dialog').waitFor()
        await page.screenshot({ path: `${dir}/${width}-${dark ? 'dark' : 'light'}-zoom.png` })
        await page.keyboard.press('Escape')
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        assert.equal(
          await review.getByRole('button', { name: 'Aprovar e publicar' }).isDisabled(),
          true
        )
        await review.getByRole('checkbox').check()
        await review.getByRole('button', { name: 'Aprovar e publicar' }).click()
        await review.waitFor({ state: 'detached' })
        await page.getByText('Publicada · v3', { exact: true }).waitFor()
        await page.getByRole('button', { name: 'Enviar imagens', exact: true }).click()
        await page
          .locator('#visual-start')
          .setInputFiles('/tmp/exercise-visual-fixtures/start.webp')
        await page
          .locator('#visual-end')
          .setInputFiles('/tmp/exercise-visual-fixtures/landscape.webp')
        await page.locator('.ev-upload-preview').first().waitFor()
        await page.getByRole('button', { name: 'Enviar para revisão', exact: true }).click()
        await page.getByText('Versão 4 em revisão', { exact: true }).waitFor()
        await review.getByRole('button', { name: 'Rejeitar', exact: true }).click()
        await page
          .getByLabel('Motivo da rejeição', { exact: true })
          .selectOption('Imagem sem relação com exercício')
        await page.getByRole('button', { name: 'Confirmar rejeição', exact: true }).click()
        await review.waitFor({ state: 'detached' })
        await page.locator('.ev-history summary').click()
        const rejected = page.locator('.ev-history li').filter({ hasText: 'Versão 4' })
        await rejected
          .getByText('Motivo: Imagem sem relação com exercício', { exact: true })
          .waitFor()
        await rejected.getByRole('button', { name: 'Excluir versão', exact: true }).click()
        await rejected.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click()
        await page.getByRole('button', { name: 'Reprocessar exclusão', exact: true }).waitFor()
        assert.equal(
          await page
            .getByText('Versão e arquivos excluídos definitivamente.', { exact: true })
            .count(),
          0
        )
        await page.getByRole('button', { name: 'Reprocessar exclusão', exact: true }).click()
        await page
          .getByText('Versão e arquivos excluídos definitivamente.', { exact: true })
          .waitFor()
        assert.equal(await page.locator('.exercise-visuals-row[aria-pressed="true"]').count(), 1)
        assert.equal(documentRequests, 1, 'actions must not reload page')
        await page.screenshot({ path: `${dir}/${width}-${dark ? 'dark' : 'light'}-history.png` })
      }
      assert.deepEqual(errors, [])
      results.push({ width, dark, signedRequests, documentRequests, images, errors })
      await context.close()
    }
  await writeFile(
    `${dir}/results.json`,
    JSON.stringify({ origin, mode, fixturesOnly: true, results }, null, 2)
  )
  console.log(JSON.stringify({ origin, mode, cases: results.length, results, screenshots: dir }))
} finally {
  await browser.close()
}

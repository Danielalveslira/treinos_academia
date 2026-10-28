// Real multi-resource story, one owner, actual PostgreSQL/Auth/REST/Storage/Edge.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { jwt } from '../keys.mjs'
const a = JSON.parse(readFileSync('.finance-local/phase51-access.json')),
  base = 'http://127.0.0.1:5173',
  evidence = 'docs/finance-restructure/phase5/evidence51',
  anon = jwt({ role: 'anon' })
const sql = (s) =>
  execFileSync(
    'docker',
    [
      'exec',
      'evolutus_price_phase1_db',
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-XtA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      s,
    ],
    { encoding: 'utf8' }
  ).trim()
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE5_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const errors = [],
  external = [],
  resources = []
async function context(session) {
  const c = await browser.newContext({ viewport: { width: 390, height: 900 } })
  if (session)
    await c.addInitScript((s) => {
      if (location.origin === 'http://127.0.0.1:5173')
        localStorage.setItem(
          'sb-organic-goldfish-r7w5rp9g754vhxp4v-5173-auth-token',
          JSON.stringify(s)
        )
    }, session)
  await c.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    if (
      u.hostname === 'organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev' &&
      u.pathname.startsWith('/_finance_local/')
    )
      return route.fulfill({ response: await route.fetch({ url: base + u.pathname + u.search }) })
    if (
      ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
      ['blob:', 'data:'].includes(u.protocol)
    )
      return route.continue()
    if (!u.hostname.includes('vercel-scripts')) external.push(u.origin)
    return route.abort()
  })
  c.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)))
  return c
}
const owner = await context(a.owner),
  admin = await context(a.admin),
  guest = await context(null),
  page = await owner.newPage(),
  review = await admin.newPage(),
  pub = await guest.newPage()
async function rpc(name, args, session = a.owner) {
  const r = await fetch(base + '/_finance_local/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  return { status: r.status, body: await r.json() }
}
async function moderate(id, decision = 'Aprovar') {
  await review.goto(base + '/admin/vitrines')
  const name = sql(
    `select display_name from public.professional_listing_drafts where listing_id='${id}'`
  )
  await review.getByLabel('Buscar cadastro', { exact: true }).fill(name)
  await review.getByRole('button', { name: 'Revisar ' + name, exact: true }).click()
  await review.getByRole('button', { name: 'Moderar cadastro', exact: true }).click()
  const d = review.getByRole('dialog')
  await d.getByLabel('Decisão', { exact: true }).selectOption({ label: decision })
  await d
    .getByLabel('Justificativa', { exact: true })
    .fill('Homologação sintética com múltiplos cadastros')
  await d.getByLabel('Confirme sua senha', { exact: true }).fill(a.adminPassword)
  await d.getByLabel('Confirmo esta decisão auditada', { exact: true }).check()
  await d.getByRole('button', { name: 'Confirmar decisão', exact: true }).click()
  await d.waitFor({ state: 'hidden' })
}
async function save() {
  const response = page.waitForResponse((r) => r.url().endsWith('/save_professional_listing_draft'))
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
  assert.ok((await response).ok())
  await page
    .getByText('Rascunho salvo. A versão pública aprovada foi preservada.', { exact: true })
    .waitFor()
}
async function purchase(days, cost) {
  await page.getByLabel('Dias de publicação', { exact: true }).fill(String(days))
  await page.getByRole('button', { name: 'Revisar contratação', exact: true }).click()
  await page.getByLabel('Autorizo o débito de ' + cost + ' EvoCash', { exact: true }).check()
  await page.getByRole('button', { name: 'Confirmar contratação', exact: true }).dblclick()
  await page.getByText('Ativa', { exact: true }).waitFor()
}
async function open(id) {
  await page.goto(base + '/minha-vitrine?cadastro=' + id)
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).waitFor()
}
try {
  for (const [i, kind, days, cost] of [
    [0, 'professional', 1, 5],
    [1, 'space', 2, 16],
    [2, 'space', 3, 24],
  ]) {
    await page.goto(base + '/minha-vitrine')
    await page
      .getByRole('heading', { name: 'Meus perfis e estabelecimentos', exact: true })
      .waitFor()
    await page
      .getByRole('button', {
        name: kind === 'space' ? 'Criar estabelecimento' : 'Criar perfil profissional',
        exact: true,
      })
      .click()
    await page.getByLabel('Nome profissional ou comercial', { exact: true }).waitFor()
    const id = new URL(page.url()).searchParams.get('cadastro')
    assert.ok(id)
    const name =
      (kind === 'space' ? 'Local ' + i : 'Profissional') + ' Multi ' + a.owner.user.id.slice(0, 8)
    await page.getByLabel('Nome profissional ou comercial', { exact: true }).fill(name)
    await page
      .getByLabel('Categoria', { exact: true })
      .selectOption(kind === 'space' ? 'academia' : 'personal_trainer')
    await page
      .getByLabel('Apresentação', { exact: true })
      .fill('Apresentação aprovada da homologação com múltiplos cadastros.')
    await page.getByLabel('Cidade', { exact: true }).fill('São Paulo')
    await page.getByLabel('Estado', { exact: true }).selectOption('SP')
    await page.getByLabel('Musculação', { exact: true }).check()
    if (kind === 'space') {
      await page
        .getByLabel('Endereço comercial público', { exact: true })
        .fill('Rua Sintética, ' + i)
      await page
        .getByLabel('Horários de funcionamento', { exact: true })
        .fill('Segunda a sexta, 8h às 18h')
    }
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 32, height: 32 } })
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'multi.png', mimeType: 'image/png', buffer: png })
    await page
      .getByText('Imagem enviada privadamente. Salve o rascunho para associá-la.', { exact: true })
      .waitFor()
    await save()
    const path = kind === 'space' ? '/locais' : '/profissionais'
    assert.equal((await pub.request.get(base + path + '/' + id)).status(), 404)
    await page.getByRole('button', { name: 'Enviar para aprovação', exact: true }).click()
    await page.getByText('Em análise', { exact: true }).waitFor()
    await moderate(id)
    await page.getByRole('button', { name: 'Atualizar cadastro', exact: true }).click()
    await page.getByText('Aprovada', { exact: true }).waitFor()
    assert.equal((await pub.request.get(base + path + '/' + id)).status(), 404)
    await purchase(days, cost)
    assert.equal((await pub.request.get(base + path + '/' + id)).status(), 200)
    const media = sql(
      `select media_id from public.published_professional_listings where listing_id='${id}'`
    )
    assert.equal(
      (
        await pub.request.get(base + '/_finance_local/functions/v1/storefront-media?id=' + media)
      ).status(),
      200
    )
    resources.push({ id, kind, name, path, media, days, cost })
  }
  assert.equal(new Set(resources.map((r) => r.id)).size, 3)
  assert.equal(
    sql(`select cash_balance from public.wallets where user_id='${a.owner.user.id}'`),
    '955'
  )
  await page.goto(base + '/minha-vitrine')
  for (const r of resources) await page.locator('a[href$="?cadastro=' + r.id + '"]').waitFor()
  assert.equal(await page.getByText('Histórico de contratações', { exact: true }).count(), 0)
  const target = resources[1],
    other = resources[2],
    period = sql(
      `select expires_at from public.visibility_entitlements where resource_id='${target.id}'`
    )
  await page.locator('a[href$="?cadastro=' + target.id + '"]').click()
  await page
    .getByLabel('Nome profissional ou comercial', { exact: true })
    .fill(target.name + ' pendente')
  await save()
  await page.getByRole('button', { name: 'Enviar para aprovação', exact: true }).click()
  await page.getByText('Em análise', { exact: true }).waitFor()
  await purchase(1, 8)
  await moderate(target.id, 'Reprovar')
  assert.match(
    await (await pub.request.get(base + target.path + '/' + target.id)).text(),
    new RegExp(target.name)
  )
  assert.doesNotMatch(
    await (await pub.request.get(base + target.path + '/' + target.id)).text(),
    /pendente/
  )
  assert.equal(
    sql(
      `select display_name from public.professional_listing_drafts where listing_id='${other.id}'`
    ),
    other.name
  )
  await page.getByRole('button', { name: 'Atualizar cadastro', exact: true }).click()
  await page.getByRole('button', { name: 'Enviar para aprovação', exact: true }).click()
  await page.getByText('Em análise', { exact: true }).waitFor()
  await moderate(target.id)
  target.name += ' pendente'
  assert.ok(
    sql(
      `select expires_at>'${period}'::timestamptz from public.visibility_entitlements where resource_id='${target.id}'`
    ) === 't'
  )
  assert.equal(
    (await rpc('get_my_professional_listing', { p_listing_id: target.id }, a.other)).body.message,
    'LISTING_NOT_FOUND'
  )
  assert.equal((await rpc('list_my_professional_listings', {}, a.other)).body.items.length, 0)
  const before = await rpc('get_my_professional_listing', { p_listing_id: other.id })
  assert.equal(
    (
      await rpc('save_professional_listing_draft', {
        p_listing_id: other.id,
        p_revision: before.body.draft.version,
        p_draft: {
          ...Object.fromEntries(
            [
              'kind',
              'displayName',
              'categoryKey',
              'modalityKeys',
              'specialties',
              'bio',
              'city',
              'uf',
              'serviceMode',
              'contacts',
              'linkedCommunityId',
              'address',
              'openingHours',
            ].map((k) => [k, before.body.draft[k]])
          ),
          mediaId: target.media,
        },
      })
    ).body.message,
    'INVALID_STOREFRONT_MEDIA'
  )
  // Real deadline: the open directory clears the expiring resource; siblings stay eligible server-side.
  sql(
    `update public.visibility_entitlements set expires_at=clock_timestamp()+interval '5 seconds' where resource_id='${other.id}'`
  )
  await pub.goto(base + '/locais')
  await pub.getByRole('button', { name: 'Detalhes de ' + other.name, exact: true }).waitFor()
  await pub
    .getByRole('button', { name: 'Detalhes de ' + other.name, exact: true })
    .waitFor({ state: 'hidden', timeout: 10000 })
  for (let i = 0; i < 100; i++) {
    if ((await pub.request.get(base + other.path + '/' + other.id)).status() === 404) break
    await new Promise((r) => setTimeout(r, 50))
  }
  assert.equal((await pub.request.get(base + other.path + '/' + other.id)).status(), 404)
  await pub.getByRole('button', { name: 'Detalhes de ' + target.name, exact: true }).waitFor()
  assert.equal(
    (
      await pub.request.get(
        base + '/_finance_local/functions/v1/storefront-media?id=' + other.media
      )
    ).status(),
    404
  )
  for (const r of resources.filter((r) => r.id !== other.id))
    assert.equal((await pub.request.get(base + r.path + '/' + r.id)).status(), 200)
  await open(other.id)
  await page.getByText('Arquivada por expiração', { exact: true }).waitFor()
  await purchase(1, 8)
  assert.equal((await pub.request.get(base + other.path + '/' + other.id)).status(), 200)
  assert.equal(
    sql(`select cash_balance from public.wallets where user_id='${a.owner.user.id}'`),
    '939'
  )
  await moderate(target.id, 'Suspender')
  assert.equal((await pub.request.get(base + target.path + '/' + target.id)).status(), 404)
  assert.equal((await pub.request.get(base + other.path + '/' + other.id)).status(), 200)
  await moderate(target.id, 'Devolver a rascunho')
  const sitemap = await (await pub.request.get(base + '/sitemap.xml')).text()
  for (const r of resources) assert.match(sitemap, new RegExp(r.id))
  const old = await pub.request.get(base + '/profissionais/' + other.id, { maxRedirects: 0 })
  assert.equal(old.status(), 308)
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  writeFileSync(
    evidence + '/browser.json',
    JSON.stringify(
      {
        passed: true,
        localOnly: true,
        owner: a.owner.user.id,
        resources,
        paidDebits: 5,
        balance: 939,
        independentContracts: true,
        revisionPrivacy: true,
        foreignOwnerDenied: true,
        crossResourceMediaDenied: true,
        independentExpiryAndRenewal: true,
        independentSuspension: true,
        sitemap: true,
        legacyRedirect: true,
        consoleErrors: errors,
      },
      null,
      2
    ) + '\n'
  )
  console.log('Three-resource same-owner browser story passed')
} catch (e) {
  writeFileSync(
    '.finance-local/browser51-failure.txt',
    await page
      .locator('body')
      .innerText()
      .catch(() => '')
  )
  writeFileSync(
    '.finance-local/admin51-failure.txt',
    await review
      .locator('body')
      .innerText()
      .catch(() => '')
  )
  await page.screenshot({ path: evidence + '/failure-owner.png', fullPage: true }).catch(() => {})
  throw e
} finally {
  await browser.close()
}

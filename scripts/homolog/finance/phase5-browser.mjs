// Full local story: real browser -> GoTrue -> REST -> SQL -> ledger/lease -> media Storage.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const a = JSON.parse(readFileSync('.finance-local/phase5-access.json'))
const base = 'http://127.0.0.1:5173',
  evidence = 'docs/finance-restructure/phase5/evidence'
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE5_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
mkdirSync(evidence, { recursive: true })
const errors = [],
  external = [],
  confirms = [],
  results = [],
  visual = []
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
    const url = new URL(route.request().url())
    if (
      url.hostname === 'organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev' &&
      url.pathname.startsWith('/_finance_local/')
    ) {
      const response = await route.fetch({ url: base + url.pathname + url.search })
      if (url.pathname.endsWith('/confirm_commercial_order') && response.ok())
        confirms.push(await response.json())
      return route.fulfill({ response })
    }
    if (
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      ['blob:', 'data:'].includes(url.protocol)
    )
      return route.continue()
    if (!url.hostname.includes('vercel-scripts')) external.push(url.origin)
    return route.abort()
  })
  c.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)))
  return c
}
const admin = await context(a.admin),
  guest = await context(null),
  pro = await context(a.professional),
  space = await context(a.establishment)
const review = await admin.newPage(),
  publicPage = await guest.newPage()
async function moderate(id, decision = 'Aprovar') {
  await review.goto(base + '/admin/vitrines')
  await review
    .getByRole('heading', { name: 'Profissionais e estabelecimentos', exact: true })
    .waitFor()
  // Search server-side by the deterministic synthetic name rather than assuming page order.
  const current = sql(
    `select display_name from public.professional_listing_drafts where listing_id='${id}'`
  )
  await review.getByLabel('Buscar cadastro', { exact: true }).fill(current)
  await review.getByRole('button', { name: 'Revisar ' + current, exact: true }).click()
  await review.getByRole('button', { name: 'Moderar cadastro', exact: true }).click()
  const d = review.getByRole('dialog')
  await d.getByLabel('Decisão', { exact: true }).selectOption({ label: decision })
  await d
    .getByLabel('Justificativa', { exact: true })
    .fill('Revisão sintética da Fase 5 no ambiente isolado')
  await d.getByLabel('Confirme sua senha', { exact: true }).fill(a.adminPassword)
  await d.getByLabel('Confirmo esta decisão auditada', { exact: true }).check()
  await d.getByRole('button', { name: 'Confirmar decisão', exact: true }).click()
  await d.waitFor({ state: 'hidden' })
}
async function save(page) {
  const response = page.waitForResponse((r) => r.url().endsWith('/save_professional_listing_draft'))
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
  const r = await response
  assert.ok(r.ok(), await r.text())
  await page
    .getByText('Rascunho salvo. A versão pública aprovada foi preservada.', { exact: true })
    .waitFor()
}
async function purchase(page, days, cost) {
  await page.getByLabel('Dias de publicação', { exact: true }).fill(String(days))
  await page.getByRole('button', { name: 'Revisar contratação', exact: true }).click()
  await page.getByLabel('Autorizo o débito de ' + cost + ' EvoCash', { exact: true }).check()
  await page.getByRole('button', { name: 'Confirmar contratação', exact: true }).dblclick()
  await page.getByText('Ativa', { exact: true }).waitFor()
}
try {
  for (const [kind, ctx, session, days, cost] of [
    ['professional', pro, a.professional, 2, 10],
    ['space', space, a.establishment, 2, 16],
  ]) {
    const page = await ctx.newPage(),
      name =
        (kind === 'space' ? 'Espaço' : 'Profissional') + ' Fase5 ' + session.user.id.slice(0, 8)
    await page.goto(base + '/minha-vitrine')
    await page
      .getByRole('button', {
        name: kind === 'space' ? 'Criar estabelecimento' : 'Criar perfil profissional',
        exact: true,
      })
      .click()
    await page.getByLabel('Nome profissional ou comercial', { exact: true }).fill(name)
    await page
      .getByLabel('Categoria', { exact: true })
      .selectOption(kind === 'space' ? 'academia' : 'personal_trainer')
    await page
      .getByLabel('Apresentação', { exact: true })
      .fill('Apresentação sintética do cadastro aprovado no Evolutus.')
    await page.getByLabel('Cidade', { exact: true }).fill('São Paulo')
    await page.getByLabel('Estado', { exact: true }).selectOption('SP')
    await page.getByLabel('Musculação', { exact: true }).check()
    await page
      .getByLabel('Especialidades (separadas por vírgula)', { exact: true })
      .fill('Treino de força, Mobilidade')
    await page.getByLabel('Site público', { exact: true }).fill('https://example.invalid/contact')
    if (kind === 'space') {
      await page
        .getByLabel('Endereço comercial público', { exact: true })
        .fill('Rua Sintética, 100')
      await page
        .getByLabel('Horários de funcionamento', { exact: true })
        .fill('Segunda a sexta, 8h às 18h')
    }
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } })
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'listing.png', mimeType: 'image/png', buffer: png })
    await page
      .getByText('Imagem enviada privadamente. Salve o rascunho para associá-la.', { exact: true })
      .waitFor()
    await save(page)
    const id = sql(
        `select id from public.professional_listings where owner_id='${session.user.id}'`
      ),
      path = kind === 'space' ? '/locais' : '/profissionais',
      mediaId = sql(
        `select media_id from public.professional_listing_drafts where listing_id='${id}'`
      )
    assert.equal(
      (await publicPage.request.get(base + path + '/' + id)).status(),
      404,
      'unpaid draft is unavailable by direct URL'
    )
    await page.getByRole('button', { name: 'Prévia privada', exact: true }).click()
    await page.getByRole('dialog').getByText(name, { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Enviar para aprovação', exact: true }).click()
    await page.getByText('Em análise', { exact: true }).waitFor()
    await moderate(id)
    await page.getByRole('button', { name: 'Atualizar cadastro', exact: true }).click()
    await page.getByText('Aprovada', { exact: true }).waitFor()
    assert.equal(
      (await publicPage.request.get(base + path + '/' + id)).status(),
      404,
      'approval alone grants no free visibility'
    )
    await purchase(page, days, cost)
    assert.equal(
      sql(`select cash_balance from public.wallets where user_id='${session.user.id}'`),
      String(1000 - cost)
    )
    const direct = await publicPage.request.get(base + path + '/' + id)
    assert.equal(direct.status(), 200)
    const html = await direct.text()
    assert.match(html, new RegExp(name))
    assert.equal(direct.headers()['x-robots-tag'], 'index, follow')
    assert.doesNotMatch(html, /ownerId|cash_balance/)
    assert.match(html, /application\/ld\+json/)
    const mediaUrl = base + '/_finance_local/functions/v1/storefront-media?id=' + mediaId
    assert.equal((await publicPage.request.get(mediaUrl)).status(), 200)
    await publicPage.goto(base + path)
    await publicPage.getByRole('button', { name: 'Detalhes de ' + name, exact: true }).click()
    await publicPage
      .getByRole('dialog')
      .getByText('Apresentação sintética do cadastro aprovado no Evolutus.', { exact: true })
      .waitFor()
    if (kind === 'space')
      await publicPage
        .getByRole('dialog')
        .getByText('Rua Sintética, 100', { exact: true })
        .waitFor()
    await publicPage.keyboard.press('Escape')
    const balanceBefore = sql(
      `select cash_balance from public.wallets where user_id='${session.user.id}'`
    )
    const revised = name + ' revisado'
    await page.getByLabel('Nome profissional ou comercial', { exact: true }).fill(revised)
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'revision.png', mimeType: 'image/png', buffer: png })
    await page
      .getByText('Imagem enviada privadamente. Salve o rascunho para associá-la.', { exact: true })
      .waitFor()
    await save(page)
    const pendingMedia = sql(
      `select media_id from public.professional_listing_drafts where listing_id='${id}'`
    )
    assert.doesNotMatch(
      await (await publicPage.request.get(base + path + '/' + id)).text(),
      new RegExp(revised)
    )
    assert.equal((await publicPage.request.get(mediaUrl)).status(), 200)
    assert.equal(
      (
        await publicPage.request.get(
          base + '/_finance_local/functions/v1/storefront-media?id=' + pendingMedia
        )
      ).status(),
      404
    )
    await page.getByRole('button', { name: 'Enviar para aprovação', exact: true }).click()
    await page.getByText('Em análise', { exact: true }).waitFor()
    await moderate(id, 'Reprovar')
    assert.equal((await publicPage.request.get(base + path + '/' + id)).status(), 200)
    assert.doesNotMatch(
      await (await publicPage.request.get(base + path + '/' + id)).text(),
      new RegExp(revised)
    )
    assert.equal(
      sql(`select cash_balance from public.wallets where user_id='${session.user.id}'`),
      balanceBefore
    )
    await page.getByRole('button', { name: 'Atualizar cadastro', exact: true }).click()
    await page.getByRole('button', { name: 'Enviar para aprovação', exact: true }).click()
    await page.getByText('Em análise', { exact: true }).waitFor()
    await moderate(id)
    await page.getByRole('button', { name: 'Atualizar cadastro', exact: true }).click()
    await page.getByText('Aprovada', { exact: true }).waitFor()
    assert.match(
      await (await publicPage.request.get(base + path + '/' + id)).text(),
      new RegExp(revised)
    )
    if (kind === 'professional') {
      sql(
        `update public.visibility_entitlements set starts_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()+interval '4 seconds' where resource_id='${id}'`
      )
      await publicPage.goto(base + path)
      await publicPage.getByRole('button', { name: 'Atualizar diretório', exact: true }).waitFor()
      await publicPage.getByRole('heading', { name: revised, exact: true }).waitFor()
      await publicPage
        .getByRole('heading', { name: revised, exact: true })
        .waitFor({ state: 'hidden', timeout: 10000 })
      for (let i = 0; i < 100; i++) {
        if ((await publicPage.request.get(base + path + '/' + id)).status() === 404) break
        await new Promise((r) => setTimeout(r, 100))
      }
      assert.equal((await publicPage.request.get(base + path + '/' + id)).status(), 404)
      assert.equal(
        (
          await publicPage.request.get(
            base + '/_finance_local/functions/v1/storefront-media?id=' + pendingMedia
          )
        ).status(),
        404
      )
      assert.doesNotMatch(
        await (await publicPage.request.get(base + '/sitemap.xml')).text(),
        new RegExp(id)
      )
      await page.getByRole('button', { name: 'Atualizar cadastro', exact: true }).click()
      await page.getByText('Arquivada por expiração', { exact: true }).waitFor()
      await purchase(page, 1, 5)
    } else {
      await moderate(id, 'Suspender')
      assert.equal((await publicPage.request.get(base + path + '/' + id)).status(), 404)
      assert.equal(
        (
          await publicPage.request.get(
            base + '/_finance_local/functions/v1/storefront-media?id=' + pendingMedia
          )
        ).status(),
        404
      )
      await page.getByRole('button', { name: 'Atualizar cadastro', exact: true }).click()
      await page.getByText('Suspensa', { exact: true }).first().waitFor()
      assert.equal(
        await page.getByRole('button', { name: 'Revisar contratação', exact: true }).count(),
        0
      )
      await moderate(id, 'Devolver a rascunho')
      await page.getByRole('button', { name: 'Atualizar cadastro', exact: true }).click()
      await purchase(page, 1, 8)
    }
    assert.equal(
      (await publicPage.request.get(base + path + '/' + id)).status(),
      200,
      'authorized renewal preserves same identity'
    )
    const ownerDirectory = await ctx.newPage()
    await ownerDirectory.goto(base + path)
    await ownerDirectory.waitForFunction(
      () => document.documentElement.dataset.publicAuth === 'authed'
    )
    await ownerDirectory.close()
    for (const width of [320, 390, 1440])
      for (const mode of ['light', 'dark']) {
        for (const [label, target, url] of [
          ['owner', page, null],
          ['public', publicPage, base + path],
        ]) {
          if (url) await target.goto(url)
          await target.setViewportSize({ width, height: 900 })
          await target.emulateMedia({ colorScheme: mode })
          await target.evaluate((m) => {
            document.documentElement.setAttribute('data-color-mode', m)
            document.documentElement.setAttribute('data-light-theme', 'light')
            document.documentElement.setAttribute('data-dark-theme', 'dark')
            window.dispatchEvent(new Event('public-theme-change'))
            window.scrollTo(0, 0)
          }, mode)
          if (label === 'owner')
            await target.getByRole('button', { name: 'Salvar rascunho', exact: true }).waitFor()
          else {
            await target.getByRole('button', { name: 'Atualizar diretório', exact: true }).waitFor()
            await target
              .getByRole('button', { name: 'Detalhes de ' + revised, exact: true })
              .waitFor()
          }
          await target.evaluate(() => document.fonts.ready)
          assert.equal(
            await target.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            kind + ' ' + label + ' ' + width + ' ' + mode
          )
          await target.screenshot({
            path: `${evidence}/${kind}-${label}-${width}-${mode}.png`,
            fullPage: true,
          })
          visual.push({ kind, label, width, mode, overflow: false })
        }
      }
    results.push({
      kind,
      id,
      path,
      name: revised,
      mediaId: pendingMedia,
      createdApprovedPaid: true,
      oneDebitOnDoubleClick: true,
      editPreservesPublic: true,
      rejectionPreservesPublic: true,
      privateMediaDenied: true,
      revisionApproval: true,
      expiryOrSuspensionEnforced: true,
      renewalPreservesIdentity: true,
      authenticatedHeader: true,
      wallet: sql(`select cash_balance from public.wallets where user_id='${session.user.id}'`),
    })
  }
  await publicPage.route('**/rest/v1/rpc/public_list_professionals', (route) => route.abort())
  await publicPage.getByRole('button', { name: 'Atualizar diretório', exact: true }).click()
  await publicPage
    .getByText('Não foi possível carregar o diretório. Tente novamente.', { exact: true })
    .waitFor()
  assert.equal(
    await publicPage
      .getByRole('button', { name: 'Detalhes de ' + results[1].name, exact: true })
      .count(),
    0
  )
  await publicPage.unroute('**/rest/v1/rpc/public_list_professionals')
  for (const [tab, url, title] of [
    ['moderation', '/admin/vitrines', 'Profissionais e estabelecimentos'],
    ['engine', '/admin/parcerias?tab=engine', 'Motor comercial'],
  ]) {
    await review.goto(base + url)
    await review.getByRole('heading', { name: title, exact: true }).waitFor()
    for (const width of [320, 390, 1440])
      for (const mode of ['light', 'dark']) {
        await review.setViewportSize({ width, height: 900 })
        await review.emulateMedia({ colorScheme: mode })
        await review.evaluate((m) => {
          document.documentElement.setAttribute('data-color-mode', m)
          document.documentElement.setAttribute('data-dark-theme', 'dark')
          document.documentElement.setAttribute('data-light-theme', 'light')
          window.scrollTo(0, 0)
        }, mode)
        assert.equal(
          await review.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false
        )
        await review.screenshot({
          path: `${evidence}/admin-${tab}-${width}-${mode}.png`,
          fullPage: true,
        })
        visual.push({ tab, width, mode, overflow: false })
      }
  }
  assert.equal(errors.length, 0, errors.join('\n'))
  assert.equal(external.length, 0, external.join('\n'))
  assert.equal(confirms.length, 4)
  writeFileSync(
    evidence + '/browser.json',
    JSON.stringify(
      {
        passed: true,
        localOnly: true,
        results,
        visual,
        confirmations: confirms.map((o) => ({ id: o.id, totalCash: o.totalCash })),
        consoleErrors: errors,
        externalFinancialRequests: external.length,
        networkFailureClearsContent: true,
      },
      null,
      2
    ) + '\n'
  )
  console.log('Both real Phase 5 browser stories passed')
} catch (e) {
  for (const [label, ctx] of [
    ['owner', pro],
    ['space', space],
  ]) {
    const p = ctx.pages()[0]
    if (p) {
      writeFileSync(
        '/tmp/phase5-' + label + '-failure.txt',
        await p
          .locator('body')
          .innerText()
          .catch(() => '')
      )
      await p
        .screenshot({ path: evidence + '/browser-' + label + '-failure.png', fullPage: true })
        .catch(() => {})
    }
  }
  await publicPage
    .screenshot({ path: evidence + '/browser-public-failure.png', fullPage: true })
    .catch(() => {})
  await review
    .screenshot({ path: evidence + '/browser-admin-failure.png', fullPage: true })
    .catch(() => {})
  writeFileSync(
    '/tmp/phase5-browser-failure.txt',
    await review
      .locator('body')
      .innerText()
      .catch(() => '')
  )
  throw e
} finally {
  await browser.close()
}

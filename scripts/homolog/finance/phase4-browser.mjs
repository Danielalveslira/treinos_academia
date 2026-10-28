// Browser -> Auth/RPC/Edge/Storage/PostgreSQL. Only loopback and synthetic accounts.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const access = JSON.parse(readFileSync('.finance-local/phase4-access.json', 'utf8'))
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PHASE4_CHROMIUM ||
    '/tmp/evolutus-phase3-browser/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const local = 'http://127.0.0.1:5173',
  evidence = 'docs/finance-restructure/phase4/evidence'
mkdirSync(evidence, { recursive: true })
const errors = [],
  rpcOrders = [],
  external = []
const sql = (source) =>
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
      '-X',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      source,
    ],
    { encoding: 'utf8' }
  ).trim()
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
      if (url.pathname.endsWith('/confirm_commercial_order') && response.ok())
        rpcOrders.push(await response.json())
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
const owner = await context(access.owner),
  admin = await context(access.admin),
  guest = await context(null),
  other = await context(access.other)
const page = await owner.newPage(),
  review = await admin.newPage(),
  publicPage = await guest.newPage()
const storeName = 'Loja sintética ' + access.owner.user.id.slice(0, 8)
let storefrontId
async function saveDialog() {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}
async function moderate(state = 'Aprovada') {
  const initial = review.waitForResponse((r) => r.url().endsWith('/list_managed_storefronts'))
  await review.goto(local + '/admin/parcerias?tab=commercial')
  let pageData = await (await initial).json()
  for (let i = 0; i < 20 && !pageData.items.some((item) => item.name === storeName); i++) {
    assert.ok(pageData.nextCursor, 'Synthetic storefront must be present in admin pagination')
    const next = review.waitForResponse((r) => r.url().endsWith('/list_managed_storefronts'))
    await review.getByRole('button', { name: 'Mais vitrines', exact: true }).click()
    pageData = await (await next).json()
  }
  await review.getByRole('button', { name: storeName, exact: true }).click()
  await review.getByRole('button', { name: 'Moderar vitrine', exact: true }).click()
  const dialog = review.getByRole('dialog')
  await dialog.getByLabel('Decisão', { exact: true }).selectOption({ label: state })
  await dialog
    .getByLabel('Motivo obrigatório', { exact: true })
    .fill('Revisão sintética do fluxo completo')
  await dialog.getByLabel('Confirme sua senha', { exact: true }).fill(access.adminPassword)
  await dialog.getByLabel('Confirmo esta alteração auditada', { exact: true }).check()
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}
try {
  await page.goto(local + '/vitrine/gerenciar')
  await page.getByRole('heading', { name: 'Minhas vitrines de produtos', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Criar vitrine', exact: true }).click()
  await page.getByLabel('Nome comercial', { exact: true }).fill(storeName)
  await saveDialog()
  await page.getByRole('button', { name: 'Editar vitrine', exact: true }).click()
  await page
    .getByLabel('Descrição da vitrine', { exact: true })
    .fill('Uma loja fictícia criada pelo teste completo de publicação.')
  await page.getByLabel('Contato público', { exact: true }).fill('Contato sintético público')
  await saveDialog()
  await page.getByRole('button', { name: 'Adicionar produto', exact: true }).click()
  for (const [label, value] of [
    ['Nome do produto', 'Produto browser'],
    ['Marca', 'Marca sintética'],
    ['Categoria', 'Fitness'],
    ['Descrição do produto', 'Produto fictício do teste completo'],
    ['URL da loja', 'https://example.invalid/product'],
    ['Preço em centavos (opcional)', '1234'],
  ])
    await page.getByLabel(label, { exact: true }).fill(value)
  // Real canvas compression converts this valid PNG to WebP before the Edge upload.
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } })
  await page
    .getByRole('dialog')
    .locator('input[type=file]')
    .setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png })
  await saveDialog()
  await page.getByRole('button', { name: 'Editar produto', exact: true }).click()
  assert.equal(
    await page.getByLabel('Nome do produto', { exact: true }).inputValue(),
    'Produto browser',
    'edit recovers existing data'
  )
  await page
    .getByLabel('Descrição do produto', { exact: true })
    .fill('Produto fictício editado com imagem preservada')
  await page
    .getByRole('dialog')
    .locator('input[type=file]')
    .setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png })
  await saveDialog()
  await page.getByRole('button', { name: 'Prévia privada', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByText('Produto fictício editado com imagem preservada', { exact: true })
    .waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Enviar para aprovação', exact: true }).click()
  await page.getByText('Em análise', { exact: true }).waitFor()
  storefrontId = sql(
    `select id from public.product_storefronts where owner_user_id='${access.owner.user.id}' order by created_at desc limit 1`
  )
  const mediaId = sql(
    `select media_id from public.partner_products where storefront_id='${storefrontId}' limit 1`
  )
  const hidden = await publicPage.request.get(local + '/vitrine/' + storefrontId)
  assert.equal(hidden.status(), 404, 'unpaid direct URL is unavailable')
  await moderate()
  await page.getByRole('button', { name: 'Atualizar vitrines', exact: true }).click()
  await page.getByText('Aprovada', { exact: true }).waitFor()
  await page.getByLabel('Dias de publicação', { exact: true }).fill('7')
  await page.getByRole('button', { name: 'Revisar contratação', exact: true }).click()
  await page.getByLabel('Autorizo o débito de 21 EvoCash', { exact: true }).check()
  await page.getByRole('button', { name: 'Confirmar contratação', exact: true }).dblclick()
  await page.getByText('Ativa', { exact: true }).waitFor()
  assert.equal(rpcOrders.length, 1, 'double-click sends one confirmation')
  assert.equal(
    sql(`select cash_balance from public.wallets where user_id='${access.owner.user.id}'`),
    '979'
  )
  await publicPage.goto(local + '/vitrine?loja=' + storefrontId)
  await publicPage.getByRole('heading', { name: storeName, exact: true }).waitFor()
  await publicPage
    .getByRole('button', { name: 'Ampliar imagem de Produto browser', exact: true })
    .click()
  await publicPage.getByRole('dialog').waitFor()
  await publicPage
    .getByRole('dialog')
    .getByText('Produto fictício editado com imagem preservada', { exact: true })
    .waitFor()
  await publicPage.keyboard.press('Escape')
  const direct = await publicPage.request.get(local + '/vitrine/' + storefrontId)
  assert.equal(direct.status(), 200)
  assert.match(await direct.text(), /Produto browser/)
  const mediaUrl = local + '/_finance_local/functions/v1/storefront-media?id=' + mediaId
  const media = await publicPage.request.get(mediaUrl)
  assert.equal(
    media.status(),
    200,
    'real validated private Storage bytes delivered publicly while eligible'
  )
  assert.match(media.headers()['cache-control'], /no-store/)
  const otherPage = await other.newPage()
  await otherPage.goto(local + '/vitrine/gerenciar')
  await otherPage.getByText('Nenhuma vitrine cadastrada.', { exact: true }).waitFor()
  const ownerPublic = await owner.newPage()
  await ownerPublic.goto(local + '/vitrine?loja=' + storefrontId)
  await ownerPublic.waitForFunction(() => document.documentElement.dataset.publicAuth === 'authed')
  assert.equal(
    await ownerPublic.getByRole('link', { name: 'Entrar', exact: true }).isVisible(),
    false,
    'authenticated storefront visitors are not prompted to sign in again'
  )
  await ownerPublic.close()
  const captures = []
  for (const width of [320, 390, 1440])
    for (const mode of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme: mode })
      await page.evaluate((mode) => {
        document.documentElement.setAttribute('data-color-mode', mode)
        document.documentElement.setAttribute('data-light-theme', 'light')
        document.documentElement.setAttribute('data-dark-theme', 'dark')
      }, mode)
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false
      )
      await page.screenshot({ path: `${evidence}/owner-${width}-${mode}.png`, fullPage: true })
      await publicPage.setViewportSize({ width, height: 900 })
      await publicPage.emulateMedia({ colorScheme: mode })
      await publicPage.evaluate((mode) => {
        document.documentElement.setAttribute('data-color-mode', mode)
        window.dispatchEvent(new Event('public-theme-change'))
      }, mode)
      assert.equal(
        await publicPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false
      )
      await publicPage.screenshot({
        path: `${evidence}/public-${width}-${mode}.png`,
        fullPage: true,
      })
      captures.push({ width, mode, ownerOverflow: false, publicOverflow: false })
    }
  // Shorten only this synthetic fixture, then load it once with a real near-term database deadline.
  sql(
    `update public.visibility_entitlements set starts_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()+interval '3 seconds' where resource_id='${storefrontId}'`
  )
  await publicPage.goto(local + '/vitrine?loja=' + storefrontId)
  await publicPage.getByRole('heading', { name: storeName, exact: true }).waitFor()
  await publicPage
    .getByRole('heading', { name: storeName, exact: true })
    .waitFor({ state: 'hidden', timeout: 10000 })
  assert.equal(
    (await publicPage.request.get(local + '/vitrine/' + storefrontId)).status(),
    404,
    'expired direct HTML responds 404'
  )
  assert.equal(
    (await publicPage.request.get(mediaUrl)).status(),
    404,
    'expired image authorization responds 404'
  )
  await page.getByRole('button', { name: 'Atualizar vitrines', exact: true }).click()
  await page.getByText('Arquivada por expiração', { exact: true }).waitFor()
  await page.getByLabel('Dias de publicação', { exact: true }).fill('2')
  await page.getByRole('button', { name: 'Revisar contratação', exact: true }).click()
  await page.getByLabel('Autorizo o débito de 6 EvoCash', { exact: true }).check()
  await page.getByRole('button', { name: 'Confirmar contratação', exact: true }).click()
  await page.getByText('Ativa', { exact: true }).waitFor()
  assert.equal(
    sql(`select cash_balance from public.wallets where user_id='${access.owner.user.id}'`),
    '973'
  )
  assert.equal(
    sql(`select count(*) from public.visibility_entitlements where resource_id='${storefrontId}'`),
    '1'
  )
  assert.equal(
    sql(
      `select count(*) from public.partner_products where storefront_id='${storefrontId}' and media_id='${mediaId}' and not archived`
    ),
    '1',
    'renewal preserves product and image'
  )
  await publicPage.goto(local + '/vitrine?loja=' + storefrontId)
  await publicPage.getByRole('heading', { name: storeName, exact: true }).waitFor()
  await moderate('Suspensa')
  await publicPage.getByRole('button', { name: 'Atualizar catálogo', exact: true }).click()
  await publicPage
    .getByRole('heading', { name: storeName, exact: true })
    .waitFor({ state: 'hidden' })
  assert.equal(
    (await publicPage.request.get(mediaUrl)).status(),
    404,
    'suspension immediately denies media'
  )
  await moderate('Rascunho')
  await page.getByRole('button', { name: 'Atualizar vitrines', exact: true }).click()
  await page.getByRole('button', { name: 'Enviar para aprovação', exact: true }).click()
  await page.getByText('Em análise', { exact: true }).waitFor()
  await moderate()
  await publicPage.goto(local + '/vitrine?loja=' + storefrontId)
  await publicPage.getByRole('heading', { name: storeName, exact: true }).waitFor()
  assert.equal(
    sql(
      `select count(*) from public.storefront_media where storefront_id='${storefrontId}' and state='ready'`
    ),
    '1',
    'replacement removes the unused old media instead of leaving an orphan'
  )
  await publicPage.route('**/rest/v1/rpc/public_product_catalog', (route) => route.abort())
  await publicPage.getByRole('button', { name: 'Atualizar catálogo', exact: true }).click()
  await publicPage
    .getByRole('heading', { name: storeName, exact: true })
    .waitFor({ state: 'hidden' })
  await publicPage
    .getByText('Não foi possível carregar os produtos agora.', { exact: true })
    .waitFor()
  await publicPage.unroute('**/rest/v1/rpc/public_product_catalog')
  await publicPage.getByRole('button', { name: 'Atualizar catálogo', exact: true }).click()
  await publicPage.getByRole('heading', { name: storeName, exact: true }).waitFor()
  assert.equal(errors.length, 0, errors.join('\n'))
  assert.equal(external.length, 0, external.join('\n'))
  writeFileSync(
    evidence + '/browser.json',
    JSON.stringify(
      {
        passed: true,
        localOnly: true,
        storefrontId,
        mediaId,
        createEditUploadApproval: true,
        oneDebitOnDoubleClick: true,
        orders: rpcOrders.map((o) => ({ id: o.id, totalCash: o.totalCash })),
        walletDelta: '27',
        anonymousPublicListing: true,
        directHtml404AfterExpiry: true,
        media404AfterExpiry: true,
        openBrowserExpiry: true,
        renewalPreservesIdentity: true,
        suspensionEffective: true,
        ownerIsolation: true,
        authenticatedPublicSession: true,
        privatePreview: true,
        networkFailureClearsPublicContent: true,
        mediaReplacementCleaned: true,
        captures,
        pageErrors: errors,
        externalFinancialRequests: external.length,
      },
      null,
      2
    ) + '\n'
  )
  console.log('Phase 4 real browser flow PASS')
} catch (e) {
  await page.screenshot({ path: '/tmp/phase4-browser-failure.png', fullPage: true })
  writeFileSync('/tmp/phase4-browser-failure.txt', await page.locator('body').innerText())
  writeFileSync('/tmp/phase4-admin-failure.txt', await review.locator('body').innerText())
  throw e
} finally {
  await browser.close()
}

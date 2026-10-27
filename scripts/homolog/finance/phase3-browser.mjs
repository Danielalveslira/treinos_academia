import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const fixture = JSON.parse(readFileSync('.finance-local/phase3-access.json', 'utf8'))
const local = 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PHASE3_CHROMIUM ||
    '/tmp/evolutus-phase3-browser/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
await context.addInitScript((session) => {
  localStorage.setItem(
    'sb-organic-goldfish-r7w5rp9g754vhxp4v-5173-auth-token',
    JSON.stringify(session)
  )
}, fixture.session)
let external = 0,
  confirmCalls = 0,
  telemetryBlocked = 0
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (
    url.hostname === 'organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev' &&
    url.pathname.startsWith('/_finance_local/')
  ) {
    if (url.pathname.endsWith('/confirm_commercial_order')) confirmCalls++
    const r = await route.fetch({ url: local + url.pathname + url.search })
    return route.fulfill({ response: r })
  }
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return route.continue()
  if (url.protocol === 'data:') return route.continue()
  if (url.hostname === 'va.vercel-scripts.com') telemetryBlocked++
  else external++
  await route.abort()
})
const paidOrders = []
const confirmationResponses = []
const numericSQL = (source) =>
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
const balanceBefore = BigInt(
  numericSQL(`select cash_balance from public.wallets where user_id='${fixture.uid}'`)
)
const page = await context.newPage(),
  errors = []
page.on('response', (response) => {
  if (response.url().endsWith('/confirm_commercial_order') && response.ok())
    confirmationResponses.push(response.json().then((order) => paidOrders.push(order)))
})
page.on('pageerror', (e) => errors.push(e.message))
const evidence = 'docs/finance-restructure/phase3/evidence'
mkdirSync(evidence, { recursive: true })
try {
  await page.goto(local + '/admin/parcerias?tab=engine')
  await page.getByRole('heading', { name: 'Motor comercial', exact: true }).waitFor()
  const card = page
    .getByRole('heading', { name: 'Serviço sintético de homologação', exact: true })
    .locator('..')
  await card.getByRole('button', { name: 'Configurar preço', exact: true }).click()
  await page.getByLabel('EvoCash por dia', { exact: true }).fill('3')
  await page.getByLabel('Mínimo de dias', { exact: true }).fill('1')
  await page.getByLabel('Máximo de dias', { exact: true }).fill('30')
  await page
    .getByLabel('Justificativa obrigatória', { exact: true })
    .fill('Teste browser sintético de publicação de preço')
  await page.getByLabel('Confirme sua senha', { exact: true }).fill(fixture.password)
  await page.getByLabel('Revisei os valores e autorizo esta operação auditada').check()
  await page.getByRole('button', { name: 'Confirmar alteração', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await card.getByText('3 EvoCash/dia · 1 a 30 dias', { exact: true }).waitFor()
  await page.getByLabel('ID do recurso sintético', { exact: true }).fill(fixture.resource)
  await page.getByLabel('Dias para contratar ou renovar', { exact: true }).fill('7')
  await page.getByRole('button', { name: 'Solicitar cotação comercial', exact: true }).click()
  await page.getByText('7 dias × 3 EvoCash =', { exact: false }).waitFor()
  await page.getByLabel('Confirmo o débito de 21 EvoCash').check()
  await page.getByRole('button', { name: 'Confirmar contratação', exact: true }).dblclick()
  await page.getByText('Direito concedido.', { exact: false }).waitFor()
  assert.equal(confirmCalls, 1, 'Double-click produces one client confirmation')
  await page.getByRole('button', { name: 'Direitos', exact: true }).click()
  await page.getByText('Ativo', { exact: true }).first().waitFor()
  // Expire only this synthetic fixture to verify a new server read while page stays open.
  execFileSync('docker', [
    'exec',
    'evolutus_price_phase1_db',
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `update public.visibility_entitlements set starts_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' where resource_id='${fixture.resource}'`,
  ])
  await page.getByRole('button', { name: 'Atualizar dados', exact: true }).click()
  await page.getByText('Vencido', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: 'Solicitar cotação comercial', exact: true }).click()
  await page.getByLabel('Confirmo o débito de 21 EvoCash').check()
  await page.getByRole('button', { name: 'Confirmar contratação', exact: true }).click()
  await page.getByText('Direito concedido.', { exact: false }).waitFor()
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
      await page.getByRole('button', { name: 'Serviços', exact: true }).click()
      await card.waitFor()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      assert.equal(overflow, false, `${width} ${mode}: no page overflow`)
      await page.screenshot({ path: `${evidence}/commercial-${width}-${mode}.png`, fullPage: true })
      captures.push({ width, mode, overflow })
    }
  // Phase 1/2 pages still mount on the same local Auth/REST stack.
  await page.goto(local + '/admin/compras-evocash?tab=pricing')
  await page
    .getByRole('heading', { name: /preço vigente/i })
    .first()
    .waitFor()
  await page.goto(local + '/evocash')
  await page.getByLabel(/Quantidade de EvoCash/).waitFor()
  await Promise.all(confirmationResponses)
  assert.equal(paidOrders.length, 2, 'One purchase and one renewal')
  const balanceAfter = BigInt(
    numericSQL(`select cash_balance from public.wallets where user_id='${fixture.uid}'`)
  )
  assert.equal(
    balanceBefore - balanceAfter,
    42n,
    'Browser RPCs debit the real local wallet exactly'
  )
  const ledger = paidOrders.map((order) => ({
    orderId: order.id,
    totalCash: order.totalCash,
    debits: Number(
      numericSQL(
        `select count(*) from public.economy_transactions where natural_key='commercial:${order.id}' and user_id='${fixture.uid}' and amount=21 and direction='debit'`
      )
    ),
  }))
  assert.ok(
    ledger.every((row) => row.debits === 1),
    'One matching ledger entry for each browser purchase'
  )
  assert.equal(errors.length, 0, errors.join('\n'))
  assert.equal(external, 0, 'No external network used')
  writeFileSync(
    evidence + '/browser.json',
    JSON.stringify(
      {
        passed: true,
        realLocalAuth: true,
        realPostgres: true,
        adminPricePublished: true,
        quoteConfirmDebitGrant: true,
        balanceDelta: '42',
        ledger,
        oneClientConfirmationOnDoubleClick: true,
        expiryRecheckedByServer: true,
        renewalAfterExpiry: true,
        phase1And2PagesRender: true,
        externalFinancialRequests: external,
        telemetryBlocked,
        pageErrors: errors,
        captures,
      },
      null,
      2
    ) + '\n'
  )
  console.log('Phase 3 browser PASS')
} catch (error) {
  await page.screenshot({ path: '/tmp/phase3-browser-failure.png', fullPage: true })
  writeFileSync('/tmp/phase3-browser-failure.txt', await page.locator('body').innerText())
  throw error
} finally {
  await browser.close()
}

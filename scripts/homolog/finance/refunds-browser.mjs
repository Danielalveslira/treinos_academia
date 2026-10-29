import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const access = JSON.parse(readFileSync('.finance-local/refunds/browser-access.json'))
const base = 'http://127.0.0.1:5174'
const browser = await chromium.launch({
  executablePath:
    process.env.REFUNDS_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const errors = [],
  blocked = [],
  checks = []
let debugPage
mkdirSync('.finance-local/refunds/captures', { recursive: true })
async function pageFor(role, width = 390, mode = 'light') {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: mode })
  await context.addInitScript(
    ({ session, mode }) => {
      localStorage.setItem('sb-127-auth-token', JSON.stringify(session))
      localStorage.setItem('colorMode', mode)
    },
    { session: access[role].session, mode }
  )
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin === base) return route.continue()
    blocked.push(url.hostname)
    return route.abort()
  })
  const page = await context.newPage()
  debugPage = page
  page.on('pageerror', (e) => errors.push(e.message))
  return page
}
try {
  const buyer = await pageFor('buyer')
  let lostResponse = null
  await buyer.context().route('**/rpc/create_refund_request', async (route) => {
    if (!lostResponse) {
      const response = await route.fetch()
      assert.equal(response.status(), 200)
      lostResponse = await response.json()
      return route.abort('failed')
    }
    return route.continue()
  })
  await buyer.goto(base + '/evocash')
  await buyer.getByRole('button', { name: 'Ver compra / Solicitar reembolso' }).first().click()
  await buyer.getByText('Arrependimento disponível até').waitFor()
  await buyer.getByRole('checkbox', { name: /Confirmo o envio/ }).check()
  await buyer.getByRole('button', { name: 'Registrar solicitação', exact: true }).click()
  await buyer.getByRole('alert').filter({ hasText: 'Não foi possível concluir' }).waitFor()
  await buyer.getByRole('button', { name: 'Registrar solicitação', exact: true }).click()
  await buyer.getByText('Recebemos sua manifestação. Protocolo').waitFor()
  const confirmation = await buyer.getByRole('status').innerText()
  assert.match(confirmation, /EVR-/)
  assert.ok(
    confirmation.includes(lostResponse.protocol),
    'lost response retry must recover the original protocol'
  )
  checks.push({
    flow: 'lost response after server commit: original protocol recovered',
    passed: true,
  })
  await buyer.getByRole('button', { name: 'Fechar', exact: true }).click()
  await buyer.getByRole('button', { name: 'Atualizar solicitações' }).click()
  await buyer.getByRole('button', { name: 'Ver solicitação', exact: true }).first().click()
  await buyer.getByRole('dialog').waitFor({ state: 'visible' })
  checks.push({ flow: 'customer submission', passed: true, confirmation })
  await buyer.screenshot({
    animations: 'disabled',
    path: '.finance-local/refunds/captures/customer-390-light.png',
  })
  const admin = await pageFor('admin', 1440)
  await admin.goto(base + '/admin/compras-evocash?tab=refunds')
  await admin.getByRole('button', { name: 'Ver solicitação', exact: true }).first().click()
  await admin.getByLabel('Ação', { exact: true }).selectOption('review')
  await admin
    .getByLabel('Comunicação ou fundamento da decisão')
    .fill('Análise iniciada na homologação sintética pelo navegador.')
  await admin.getByLabel('Confirme sua senha').fill(access.admin.password)
  await admin
    .getByRole('checkbox', { name: 'Confirmo esta ação e a comunicação ao solicitante' })
    .check()
  await admin.getByRole('button', { name: 'Iniciar análise', exact: true }).click()
  await admin.getByText('Em análise · Recebida').waitFor()
  checks.push({ flow: 'admin recent authentication and review', passed: true })
  async function action(value, reason, expected, prepare = async () => {}) {
    await admin.getByLabel('Ação', { exact: true }).selectOption(value)
    await prepare()
    await admin.getByLabel('Comunicação ou fundamento da decisão').fill(reason)
    await admin.getByLabel('Confirme sua senha').fill(access.admin.password)
    await admin
      .getByRole('checkbox', { name: 'Confirmo esta ação e a comunicação ao solicitante' })
      .check()
    const names = {
      approve: 'Aprovar análise',
      provider_pending: 'Registrar estorno em processamento',
      confirm_provider: 'Registrar comprovação do estorno',
      complete: 'Conciliar e concluir',
    }
    await admin.getByRole('button', { name: names[value], exact: true }).click()
    await admin
      .getByRole('dialog')
      .getByText(expected + ' · Recebida', { exact: false })
      .waitFor()
  }
  await action(
    'approve',
    'Restituição integral sintética aprovada após análise jurídica.',
    'Aprovada',
    async () => {
      await admin.getByLabel('Classificação revisável do contratante').selectOption('individual')
      await admin
        .getByLabel('Fundamento jurídico/comercial e valor devido (sem presumir CDC no B2B)')
        .fill(
          'Análise jurídica sintética confirmando restituição integral, sem desconto automático por consumo e sem contratos acessórios pendentes.'
        )
      await admin
        .getByRole('checkbox', {
          name: 'Enquadramento jurídico revisado, incluindo consumo e restituição integral quando devida',
        })
        .check()
      await admin
        .getByRole('checkbox', {
          name: 'Contratos relacionados, promoções e compensações anteriores revisados para impedir devolução dupla',
        })
        .check()
    }
  )
  await action(
    'provider_pending',
    'Estorno inteiramente simulado no canal original da InfinitePay.',
    'Aguardando estorno na InfinitePay'
  )
  await action(
    'confirm_provider',
    'Comprovação sintética do provedor, sem chamada financeira externa.',
    'Estorno comprovado administrativamente',
    async () => {
      const values = {
        'Identificador único do estorno': 'browser-refund-' + access.purchaseId,
        'Referência da evidência administrativa': 'synthetic-browser-proof-' + access.purchaseId,
        'NSU da transação original': access.nsu + '-txn',
        'Identificador do lojista': 'synthetic-merchant',
        'Valor integral em centavos BRL': '590',
        'Data/hora efetiva ISO com fuso (ex.: 2026-10-29T12:00:00-03:00)': new Date().toISOString(),
      }
      for (const [label, value] of Object.entries(values))
        await admin.getByLabel(label, { exact: true }).fill(value)
    }
  )
  await action(
    'complete',
    'Conciliação final com compensação única do ledger existente.',
    'Concluída'
  )
  checks.push({
    flow: 'approved, external evidence and unique settlement through UI',
    passed: true,
  })

  await admin.getByRole('button', { name: 'Fechar', exact: true }).click()
  for (const width of [320, 390, 1440])
    for (const mode of ['light', 'dark']) {
      const page = await pageFor('buyer', width, mode)
      await page.goto(base + '/evocash')
      await page.getByRole('button', { name: 'Ver solicitação', exact: true }).first().click()
      await page.getByRole('dialog').getByText('Concluída · Recebida').waitFor()
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'page overflow ' + width
      )
      await page.getByRole('dialog').waitFor({ state: 'visible' })
      await page.screenshot({
        animations: 'disabled',
        path: `.finance-local/refunds/captures/detail-${width}-${mode}.png`,
      })
      checks.push({ flow: 'viewport and detail', width, mode, passed: true })
      await page.context().close()
    }
  assert.deepEqual(errors, [])
  writeFileSync(
    'docs/finance-restructure/refunds/evidence/browser.json',
    JSON.stringify(
      {
        checks,
        errors,
        blockedHosts: [...new Set(blocked)],
        limitations: [
          'No real provider calls. Realtime service is not provisioned in this isolated preview.',
        ],
      },
      null,
      2
    ) + '\n'
  )
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors }))
} catch (e) {
  writeFileSync(
    '.finance-local/refunds/browser-failure.txt',
    e.stack +
      '\n' +
      (debugPage ? await debugPage.locator('body').innerText() : '') +
      '\n' +
      JSON.stringify(errors)
  )
  if (debugPage) await debugPage.screenshot({ path: '.finance-local/refunds/captures/failure.png' })
  throw e
} finally {
  await browser.close()
}

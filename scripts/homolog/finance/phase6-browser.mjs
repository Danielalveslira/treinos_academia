// Real browser -> Auth/REST -> PostgreSQL local story. No financial provider calls.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { advertisingContext } from './phase6-browser-context.mjs'
const a = JSON.parse(readFileSync('.finance-local/phase6-access.json'))
const base = 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE6_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const errors = [],
  warnings = []
async function context(session) {
  const c = await advertisingContext(browser, session)
  c.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(e.message))
    p.on('console', (m) => {
      if (m.type() === 'error') {
        if (m.text().includes('net::ERR_FAILED'))
          warnings.push({ message: m.text(), location: m.location() })
        else errors.push(m.text())
      }
    })
  })
  return c
}
const owner = await context(a.owner),
  admin = await context(a.admin)
try {
  const p = await owner.newPage()
  await p.goto(base + '/meus-anuncios')
  await p.getByLabel('Nome do anunciante').fill('Empresa sintética Fase 6')
  await p.getByRole('button', { name: 'Criar minha conta de anunciante' }).click()
  await p.getByRole('heading', { name: 'Central de publicidade' }).waitFor()
  await p.getByRole('button', { name: 'Nova campanha', exact: true }).click()
  await p.getByLabel('Nome e título do anúncio').fill('Publicidade sintética de revisão Fase 6')
  await p.getByLabel('Texto publicitário').fill('Material sintético, sem oferta comercial real.')
  await p.getByLabel('Destino HTTPS').fill('https://example.invalid/phase6')
  await p.getByRole('button', { name: 'Salvar rascunho' }).click()
  await p
    .getByRole('heading', { name: 'Publicidade sintética de revisão Fase 6', exact: true })
    .waitFor()
  await p.getByRole('button', { name: 'Preparar revisão', exact: true }).click()
  await p.getByRole('button', { name: 'Salvar e enviar à moderação' }).click()
  await p.getByText('Em análise · Rascunho', { exact: true }).waitFor()
  const ad = await admin.newPage()
  await ad.goto(base + '/admin/parcerias?tab=autonomous')
  await ad.getByRole('heading', { name: 'Publicidade autônoma', exact: true }).waitFor()
  await ad
    .getByLabel('Justificativa da operação')
    .fill('Aprovação de campanha exclusivamente sintética')
  await ad.getByLabel('Senha para autenticação recente').fill(a.adminPassword)
  const card = ad
    .locator('div')
    .filter({
      has: ad.getByRole('heading', {
        name: 'Publicidade sintética de revisão Fase 6',
        exact: true,
      }),
    })
    .filter({ has: ad.getByRole('button', { name: 'Aprovar revisão', exact: true }) })
    .last()
  await card.getByRole('button', { name: 'Aprovar revisão', exact: true }).click()
  await p.reload()
  await p.getByRole('button', { name: 'Revisar contratação', exact: true }).waitFor()
  await p.getByRole('button', { name: 'Revisar contratação', exact: true }).click()
  await p.getByLabel('Autorizo o débito de 7 EvoCash').check()
  await p.getByRole('button', { name: 'Confirmar contratação', exact: true }).click()
  await p.getByRole('button', { name: 'Histórico de contratações', exact: true }).waitFor()
  await p
    .getByRole('button', { name: 'Confirmar contratação', exact: true })
    .waitFor({ state: 'detached' })
  const accountId = new URL(p.url()).searchParams.get('accountId')
  const snapshots = []
  for (const width of [320, 390, 1440])
    for (const mode of ['light', 'dark']) {
      await p.setViewportSize({ width, height: 900 })
      await p.emulateMedia({ colorScheme: mode })
      await p.evaluate((m) => {
        localStorage.setItem('colorMode', m)
        document.documentElement.setAttribute('data-color-mode', m)
      }, mode)
      await p.screenshot({
        path: `docs/finance-restructure/phase6/evidence/central-${width}-${mode}.png`,
        fullPage: true,
      })
      assert.equal(
        await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `No overflow ${width} ${mode}`
      )
      snapshots.push({ width, mode, overflow: false })
    }
  assert.equal(errors.length, 0, errors.join('\n'))
  writeFileSync(
    'docs/finance-restructure/phase6/evidence/browser.json',
    JSON.stringify(
      {
        localOnly: true,
        accountId,
        create: true,
        submit: true,
        approve: true,
        quote: true,
        purchase: true,
        snapshots,
        errors,
        environmentWarnings: warnings,
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    JSON.stringify({
      localOnly: true,
      accountId,
      errors,
      snapshots: snapshots.length,
      environmentWarnings: warnings.length,
    })
  )
} catch (e) {
  const pages = owner.pages()
  if (pages[0])
    writeFileSync(
      '.finance-local/phase6-browser-failure.txt',
      await pages[0].locator('body').innerText()
    )
  throw e
} finally {
  await browser.close()
}

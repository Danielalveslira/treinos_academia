// Stable-content visual verification, independent of transactional story fixtures.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
const a = JSON.parse(readFileSync('.finance-local/phase51-access.json')),
  story = JSON.parse(readFileSync('docs/finance-restructure/phase5/evidence51/browser.json')),
  base = 'http://127.0.0.1:5173',
  evidence = 'docs/finance-restructure/phase5/evidence51',
  host = 'organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev'
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE5_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const visual = [],
  errors = [],
  environmentWarnings = []
async function context(session) {
  const c = await browser.newContext()
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
    if (u.hostname === host && u.pathname.startsWith('/_finance_local/'))
      return route.fulfill({ response: await route.fetch({ url: base + u.pathname + u.search }) })
    if (['127.0.0.1', 'localhost'].includes(u.hostname) || ['blob:', 'data:'].includes(u.protocol))
      return route.continue()
    return route.abort()
  })
  c.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(e.message))
    p.on('console', (message) => {
      if (message.type() === 'error') {
        const url = message.location().url || ''
        const text = message.text()
        if (
          text.startsWith(
            "WebSocket connection to 'wss://" + host + '/_finance_local/realtime/v1/websocket?'
          ) &&
          text.endsWith('Unexpected response code: 404')
        ) {
          environmentWarnings.push({ service: 'local-realtime', status: 404 })
          return
        }
        if (!url || url.startsWith(base) || url.includes('/_finance_local/'))
          errors.push(message.text())
      }
    })
  })
  return c
}
async function closeContext(context) {
  // Drain proxy handlers before disposing their request context.
  await context.unrouteAll({ behavior: 'wait' })
  await context.close()
}
async function theme(page, width, mode) {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ colorScheme: mode })
  await page.evaluate((m) => {
    document.documentElement.setAttribute('data-color-mode', m)
    document.documentElement.setAttribute('data-light-theme', 'light')
    document.documentElement.setAttribute('data-dark-theme', 'dark')
    window.dispatchEvent(new Event('public-theme-change'))
  }, mode)
}
async function capture(page, label, width, mode) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() =>
    Array.from(document.images)
      .filter((i) => i.getBoundingClientRect().top < innerHeight)
      .every((i) => i.complete)
  )
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    label
  )
  if (await page.getByRole('dialog').count())
    assert.equal(
      await page.getByRole('dialog').evaluate((e) => e.scrollWidth > e.clientWidth),
      false,
      label + ' dialog'
    )
  await page.screenshot({
    path: `${evidence}/${label}-${width}-${mode}.png`,
    fullPage: !(await page.getByRole('dialog').count()),
    animations: 'disabled',
  })
  visual.push({ label, width, mode, contentLoaded: true, overflow: false })
}
try {
  for (const [i, row] of story.resources.entries()) {
    const owner = await context(a.owner),
      guest = await context(null),
      page = await owner.newPage(),
      pub = await guest.newPage()
    await page.goto(base + '/minha-vitrine?cadastro=' + row.id)
    await pub.goto(base + row.path)
    for (const width of [320, 390, 1440])
      for (const mode of ['light', 'dark']) {
        await theme(page, width, mode)
        await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).waitFor()
        await page.getByLabel('Nome profissional ou comercial', { exact: true }).waitFor()
        await capture(page, row.kind + '-' + i + '-owner', width, mode)
        await page.getByRole('button', { name: 'Prévia privada', exact: true }).click()
        await page.getByRole('dialog').getByText(row.name, { exact: true }).waitFor()
        await capture(page, row.kind + '-' + i + '-owner-modal', width, mode)
        await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
        await page.getByRole('dialog').waitFor({ state: 'hidden' })
        await theme(pub, width, mode)
        await pub.getByRole('button', { name: 'Detalhes de ' + row.name, exact: true }).waitFor()
        await capture(pub, row.kind + '-' + i + '-public', width, mode)
        await pub.getByRole('button', { name: 'Detalhes de ' + row.name, exact: true }).click()
        await pub
          .getByRole('dialog')
          .getByText('Apresentação aprovada da homologação com múltiplos cadastros.', {
            exact: true,
          })
          .waitFor()
        await capture(pub, row.kind + '-' + i + '-public-modal', width, mode)
        await pub.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
        await pub.getByRole('dialog').waitFor({ state: 'hidden' })
      }
    await closeContext(owner)
    await closeContext(guest)
  }
  const central = await context(a.owner),
    hub = await central.newPage()
  const financialReads = []
  hub.on('request', (r) => {
    if (/get_my_professional_listing|list_listing_commercial_orders/.test(r.url()))
      financialReads.push(r.url())
  })
  await hub.goto(base + '/minha-vitrine')
  await hub.getByRole('heading', { name: 'Meus perfis e estabelecimentos', exact: true }).waitFor()
  for (const row of story.resources)
    await hub.getByRole('heading', { name: row.name, exact: true }).waitFor()
  assert.deepEqual(financialReads, [])
  for (const width of [320, 390, 1440])
    for (const mode of ['light', 'dark']) {
      await theme(hub, width, mode)
      await capture(hub, 'owner-central', width, mode)
    }
  await hub.getByLabel('Tipo de cadastro', { exact: true }).selectOption('space')
  await hub
    .getByRole('heading', { name: story.resources[0].name, exact: true })
    .waitFor({ state: 'hidden' })
  for (const row of story.resources.filter((r) => r.kind === 'space'))
    await hub.getByRole('heading', { name: row.name, exact: true }).waitFor()
  const renewalTarget = story.resources[1]
  await hub.locator('a[href$="?cadastro=' + renewalTarget.id + '#publicacao"]').click()
  await hub.getByText('Publicação de ' + renewalTarget.name, { exact: true }).waitFor()
  await hub.waitForFunction((name) => {
    const p = [...document.querySelectorAll('p')].find(
      (e) => e.textContent === 'Publicação de ' + name
    )
    if (!p) return false
    const r = p.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= innerHeight
  }, renewalTarget.name)
  assert.equal(new URL(hub.url()).searchParams.get('cadastro'), renewalTarget.id)
  await closeContext(central)
  const admin = await context(a.admin),
    page = await admin.newPage()
  for (const [tab, url, title] of [
    ['moderation', '/admin/vitrines', 'Profissionais e estabelecimentos'],
    ['engine', '/admin/parcerias?tab=engine', 'Motor comercial'],
  ]) {
    await page.goto(base + url)
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    if (tab === 'moderation') {
      await page.getByLabel('Buscar cadastro', { exact: true }).fill(story.resources[0].name)
      await page
        .getByRole('button', { name: 'Revisar ' + story.resources[0].name, exact: true })
        .click()
      await page.getByRole('button', { name: 'Moderar cadastro', exact: true }).waitFor()
    } else
      await page
        .getByRole('button', { name: 'Atualizar dados', exact: true })
        .waitFor({ state: 'visible' })
    for (const width of [320, 390, 1440])
      for (const mode of ['light', 'dark']) {
        await theme(page, width, mode)
        if (tab === 'engine')
          await page.getByRole('button', { name: 'Atualizar dados', exact: true }).isEnabled()
        await capture(page, 'admin-' + tab, width, mode)
        if (tab === 'moderation') {
          await page.getByRole('button', { name: 'Moderar cadastro', exact: true }).click()
          await page.getByRole('dialog').getByLabel('Decisão', { exact: true }).waitFor()
          await capture(page, 'admin-moderation-modal', width, mode)
          await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
          await page.getByRole('dialog').waitFor({ state: 'hidden' })
        }
      }
  }
  await page.goto(base + '/admin/vitrines')
  await page.getByRole('button', { name: 'Configurar limites de cadastros', exact: true }).click()
  await page.getByLabel('Tipo para configurar', { exact: true }).selectOption('space')
  await page.getByLabel('Máximo por proprietário', { exact: true }).fill('6')
  await page
    .getByLabel('Justificativa do limite', { exact: true })
    .fill('Ajuste sintético para validar a administração local')
  await page.getByLabel('Senha para configurar limite', { exact: true }).fill(a.adminPassword)
  await page.getByLabel('Confirmo esta configuração auditada', { exact: true }).check()
  await page.getByRole('button', { name: 'Salvar limite de cadastros', exact: true }).click()
  await page
    .getByText('Limite registrado. Contratos existentes foram preservados.', { exact: true })
    .waitFor()
  for (const width of [320, 390, 1440])
    for (const mode of ['light', 'dark']) {
      await theme(page, width, mode)
      await capture(page, 'admin-listing-limits', width, mode)
    }
  assert.deepEqual(errors, [])
  writeFileSync(
    evidence + '/visual.json',
    JSON.stringify(
      { passed: true, localOnly: true, visual, consoleErrors: errors, environmentWarnings },
      null,
      2
    ) + '\n'
  )
  console.log('Stable visual/content checks: ' + visual.length)
} finally {
  for (const context of browser.contexts()) await closeContext(context)
  await browser.close()
}

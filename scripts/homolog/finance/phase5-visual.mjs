// Stable-content visual verification, independent of transactional story fixtures.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
const a = JSON.parse(readFileSync('.finance-local/phase5-access.json')),
  story = JSON.parse(readFileSync('docs/finance-restructure/phase5/evidence/browser.json')),
  base = 'http://127.0.0.1:5173',
  evidence = 'docs/finance-restructure/phase5/evidence',
  host = 'organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev'
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE5_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
const visual = [],
  errors = []
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
  c.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)))
  return c
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
  await page.screenshot({ path: `${evidence}/${label}-${width}-${mode}.png`, fullPage: true })
  visual.push({ label, width, mode, contentLoaded: true, overflow: false })
}
try {
  for (const [i, row] of story.results.entries()) {
    const owner = await context(i ? a.establishment : a.professional),
      guest = await context(null),
      page = await owner.newPage(),
      pub = await guest.newPage()
    await page.goto(base + '/minha-vitrine')
    await pub.goto(base + row.path)
    for (const width of [320, 390, 1440])
      for (const mode of ['light', 'dark']) {
        await theme(page, width, mode)
        await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).waitFor()
        await page.getByLabel('Nome profissional ou comercial', { exact: true }).waitFor()
        await capture(page, row.kind + '-owner', width, mode)
        await page.getByRole('button', { name: 'Prévia privada', exact: true }).click()
        await page.getByRole('dialog').getByText(row.name, { exact: true }).waitFor()
        await capture(page, row.kind + '-owner-modal', width, mode)
        await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'})
        await theme(pub, width, mode)
        await pub.getByRole('button', { name: 'Detalhes de ' + row.name, exact: true }).waitFor()
        await capture(pub, row.kind + '-public', width, mode)
        await pub.getByRole('button', { name: 'Detalhes de ' + row.name, exact: true }).click()
        await pub
          .getByRole('dialog')
          .getByText('Apresentação sintética do cadastro aprovado no Evolutus.', { exact: true })
          .waitFor()
        await capture(pub, row.kind + '-public-modal', width, mode)
        await pub.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await pub.getByRole('dialog').waitFor({state:'hidden'})
      }
    await owner.close()
    await guest.close()
  }
  const admin = await context(a.admin),
    page = await admin.newPage()
  for (const [tab, url, title] of [
    ['moderation', '/admin/vitrines', 'Profissionais e estabelecimentos'],
    ['engine', '/admin/parcerias?tab=engine', 'Motor comercial'],
  ]) {
    await page.goto(base + url)
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    if (tab === 'moderation') {
      await page.getByLabel('Buscar cadastro', { exact: true }).fill(story.results[0].name)
      await page
        .getByRole('button', { name: 'Revisar ' + story.results[0].name, exact: true })
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
          await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'})
        }
      }
  }
  assert.deepEqual(errors, [])
  writeFileSync(
    evidence + '/visual.json',
    JSON.stringify({ passed: true, localOnly: true, visual, consoleErrors: errors }, null, 2) + '\n'
  )
  console.log('Stable visual/content checks: ' + visual.length)
} finally {
  await browser.close()
}

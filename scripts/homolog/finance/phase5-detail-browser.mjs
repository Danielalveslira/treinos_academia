import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const story = JSON.parse(readFileSync('docs/finance-restructure/phase5/evidence/browser.json')),
  base = 'http://127.0.0.1:5173',
  sql = (s) =>
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
const results = []
try {
  for (const row of story.results) {
    const old = sql(
      `select expires_at from public.visibility_entitlements where resource_id='${row.id}'`
    )
    try {
      const plain = await browser.newContext({ javaScriptEnabled: false }),
        page = await plain.newPage()
      await page.goto(base + row.path + '/' + row.id)
      await page.getByRole('heading', { name: row.name, exact: true }).waitFor()
      assert.match(await page.locator('body').innerText(), /Apresentação sintética/)
      await plain.close()
      sql(
        `update public.visibility_entitlements set expires_at=clock_timestamp()+interval '5 seconds' where resource_id='${row.id}'`
      )
      const ctx = await browser.newContext(),
        live = await ctx.newPage()
      await live.goto(base + row.path + '/' + row.id)
      await live.getByRole('heading', { name: row.name, exact: true }).waitFor()
      await live
        .getByRole('heading', { name: row.name, exact: true })
        .waitFor({ state: 'hidden', timeout: 10000 })
      assert.ok(!(await live.locator('body').innerText()).includes(row.name))
      assert.equal(await live.locator('script[type="application/ld+json"]').count(), 0)
      assert.equal(await live.title(), 'Publicação indisponível | Evolutus')
      assert.equal(await live.locator('[data-public-lease] img').count(), 0)
      await ctx.close()
      results.push({
        kind: row.kind,
        noJavascriptUsefulHtml: true,
        openDetailExpires: true,
        approvedNameRemoved: true,
        structuredDataRemoved: true,
        imagesRemoved: true,
      })
    } finally {
      sql(
        `update public.visibility_entitlements set expires_at='${old}' where resource_id='${row.id}'`
      )
    }
  }
  writeFileSync(
    'docs/finance-restructure/phase5/evidence/detail-browser.json',
    JSON.stringify({ passed: true, localOnly: true, results }, null, 2) + '\n'
  )
  console.log('No-JS crawlers and open detail expiration passed')
} finally {
  await browser.close()
}

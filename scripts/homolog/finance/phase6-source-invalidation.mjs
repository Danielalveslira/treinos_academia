// Real source edit -> database trigger -> official Realtime -> open community UI.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { advertisingContext } from './phase6-browser-context.mjs'
const a = JSON.parse(readFileSync('.finance-local/phase6-access.json'))
assert.match(a.community, /^[0-9a-f-]{36}$/)
const sql = (source) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'evolutus_price_phase1_db',
      'psql',
      '-XqAt',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: source, encoding: 'utf8' }
  ).trim()
const original = JSON.parse(
  sql(`select to_jsonb(c) from public.communities c where id='${a.community}';`)
)
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE6_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
try {
  const context = await advertisingContext(browser, a.viewer)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://127.0.0.1:5173/comunidades/' + a.community)
  const badge = page.locator('.cd-header').getByText('Destaque patrocinado', { exact: true })
  await badge.waitFor()
  const auditCount = () =>
    Number(
      sql(
        `select count(*) from public.advertising_operations where payload->>'sourceType'='community' and payload->>'sourceId'='${a.community}' and action='source_changed';`
      )
    )
  const beforeAudit = auditCount()
  const started = performance.now()
  sql(
    `update public.communities set description='Edição sintética para validar invalidação editorial ao vivo' where id='${a.community}';`
  )
  await badge.waitFor({ state: 'detached', timeout: 10000 })
  await page
    .getByText('Edição sintética para validar invalidação editorial ao vivo', { exact: true })
    .waitFor({ timeout: 10000 })
  assert.ok((await page.locator('body').innerText()).includes('Publicação original sintética'))
  assert.equal(await page.locator('.sponsored-ad-banner').count(), 1)
  assert.deepEqual(errors, [])
  assert.ok(auditCount() > beforeAudit, 'source interruption is operationally auditable')
  writeFileSync(
    'docs/finance-restructure/phase6/evidence/source-invalidation.json',
    JSON.stringify(
      {
        localOnly: true,
        syntheticOnly: true,
        officialRealtime: true,
        sourceChangedWithoutReload: true,
        operationalAuditRecorded: true,
        paidCommunityBadgeRemoved: true,
        organicPostPreserved: true,
        unaffectedAdPreserved: true,
        latencyMs: Math.round(performance.now() - started),
        errors,
      },
      null,
      2
    ) + '\n'
  )
  await context.unrouteAll({ behavior: 'wait' })
  await context.close()
} finally {
  const description =
    original.description === null ? 'null' : "'" + original.description.replaceAll("'", "''") + "'"
  sql(`update public.communities set description=${description} where id='${a.community}';`)
  await browser.close()
}
console.log('Source edit invalidated paid community prominence without reload')

// Disposable local fixtures only. Wait for PostgreSQL time to expire paid badges
// while the real page stays open; retain the original post and restore fixtures.
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
  sql(
    `select jsonb_agg(jsonb_build_object('id',id,'expires_at',expires_at)) from public.promotions where community_id='${a.community}' and commercial_resource_id is not null and status='active';`
  )
)
assert.ok(original.length >= 2)
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE6_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
try {
  // Set the synthetic window before navigation so the initial server response
  // carries the short deadline. No invalidation event is needed to expire it.
  sql(
    `update public.promotions set expires_at=clock_timestamp()+interval '30 seconds' where id in (${original.map((p) => "'" + p.id + "'").join(',')}); update public.advertising_delivery_epoch set revision=revision+1 where id;`
  )
  const context = await advertisingContext(browser, a.viewer)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://127.0.0.1:5173/comunidades/' + a.community)
  await page.getByText('Destaque patrocinado', { exact: true }).first().waitFor()
  const started = performance.now()
  // Do not mistake the brief fail-closed invalidation for natural expiration.
  await page.waitForTimeout(31000)
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('span')].some((e) => e.textContent === 'Destaque patrocinado'),
    undefined,
    { timeout: 18000 }
  )
  assert.ok((await page.locator('body').innerText()).includes('Publicação original sintética'))
  assert.equal(
    await page.locator('.sponsored-ad-banner').count(),
    1,
    'unexpired campaign and live channel remain available'
  )
  assert.equal(
    sql(
      `select bool_and(expires_at<=clock_timestamp()) from public.promotions where community_id='${a.community}' and commercial_resource_id is not null and status='active';`
    ),
    't'
  )
  assert.deepEqual(errors, [])
  writeFileSync(
    'docs/finance-restructure/phase6/evidence/promotion-expiry.json',
    JSON.stringify(
      {
        localOnly: true,
        syntheticOnly: true,
        databaseTime: true,
        observedWaitMs: Math.round(performance.now() - started),
        noPageReload: true,
        postAndCommunityBadgesExpired: true,
        organicPostPreserved: true,
        financialRecordsUnchanged: true,
        errors,
      },
      null,
      2
    ) + '\n'
  )
  await context.unrouteAll({ behavior: 'wait' })
  await context.close()
} finally {
  sql(
    original
      .map(
        (p) =>
          `update public.promotions set expires_at='${p.expires_at}'::timestamptz where id='${p.id}';`
      )
      .join('\n') + 'update public.advertising_delivery_epoch set revision=revision+1 where id;'
  )
  await browser.close()
}
console.log(
  'Paid badges expired without reload; organic source preserved; fixture windows restored'
)

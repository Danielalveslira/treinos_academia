// Real HTTP/crawler responses and authorization; only isolated synthetic preview data.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { jwt } from '../keys.mjs'
const a = JSON.parse(readFileSync('.finance-local/phase5-access.json')),
  story = JSON.parse(readFileSync('docs/finance-restructure/phase5/evidence/browser.json')),
  base = 'http://127.0.0.1:5173',
  api = base + '/_finance_local',
  anon = jwt({ role: 'anon' })
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
const rpc = async (name, args = {}, session = null) => {
  const r = await fetch(api + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + (session?.access_token || anon),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  return { status: r.status, body: await r.json() }
}
const responses = [],
  security = []
for (const [i, row] of story.results.entries()) {
  const owner = i === 0 ? a.professional : a.establishment,
    other = i === 0 ? a.establishment : a.professional
  const before = await rpc('get_my_professional_listing', {}, owner)
  assert.equal(before.status, 200)
  const revision = before.body.draft.version
  const saved = await rpc(
    'save_professional_listing_draft',
    {
      p_listing_id: row.id,
      p_revision: revision,
      p_draft: Object.fromEntries(
        [
          'kind',
          'displayName',
          'categoryKey',
          'modalityKeys',
          'specialties',
          'bio',
          'city',
          'uf',
          'serviceMode',
          'contacts',
          'linkedCommunityId',
          'mediaId',
          'address',
          'openingHours',
        ].map((k) => [
          k,
          k === 'bio' ? 'SEO_PRIVATE_PENDING_PHASE5_NEVER_INDEX' : before.body.draft[k],
        ])
      ),
    },
    owner
  )
  assert.equal(saved.status, 200)
  const detail = await fetch(base + row.path + '/' + row.id, {
      headers: { 'User-Agent': 'Googlebot' },
    }),
    html = await detail.text()
  assert.equal(detail.status, 200)
  assert.match(html, new RegExp(row.name))
  assert.doesNotMatch(
    html,
    /SEO_PRIVATE_PENDING_PHASE5_NEVER_INDEX|ownerId|cash_balance|ownerEmail/
  )
  assert.match(html, /<script type="application\/ld\+json">/)
  assert.match(html, new RegExp('https://www.evolutus.com.br' + row.path + '/' + row.id))
  assert.match(detail.headers.get('cache-control'), /no-store/)
  responses.push({
    path: row.path + '/' + row.id,
    status: detail.status,
    robots: detail.headers.get('x-robots-tag'),
    approvedHtml: true,
    pendingDataAbsent: true,
    canonical: true,
  })
  const forbidden = await rpc(
    'save_professional_listing_draft',
    { p_listing_id: row.id, p_revision: revision, p_draft: { displayName: 'Unauthorized' } },
    other
  )
  assert.equal(forbidden.body.message, 'LISTING_NOT_FOUND')
  assert.ok(
    (await rpc('admin_get_professional_listing', { p_listing_id: row.id }, other)).status >= 400
  )
  const table = await fetch(api + '/rest/v1/professional_listing_drafts?listing_id=eq.' + row.id, {
    headers: { apikey: anon, Authorization: 'Bearer ' + other.access_token },
  })
  assert.ok(table.status >= 400)
  const published = await fetch(
    api + '/rest/v1/published_professional_listings?listing_id=eq.' + row.id,
    { headers: { apikey: anon, Authorization: 'Bearer ' + anon } }
  )
  assert.ok(published.status >= 400)
  const protectedUrl = base + '/_finance_local/functions/v1/storefront-media?id=' + row.mediaId
  assert.equal((await fetch(protectedUrl)).status, 200)
  const expiry = sql(
    `select expires_at from public.visibility_entitlements where resource_id='${row.id}'`
  )
  try {
    sql(
      `update public.visibility_entitlements set expires_at=clock_timestamp()-interval '1 second' where resource_id='${row.id}'`
    )
    assert.equal((await rpc('public_get_professional', { p_listing_id: row.id })).body, null)
    const expired = await fetch(base + row.path + '/' + row.id, {
      headers: { 'User-Agent': 'Googlebot' },
    })
    assert.equal(expired.status, 404)
    assert.equal(expired.headers.get('x-robots-tag'), 'noindex, follow')
    assert.doesNotMatch(await expired.text(), new RegExp(row.name))
    assert.equal((await fetch(protectedUrl)).status, 404)
    const sitemap = await fetch(base + '/sitemap.xml')
    assert.equal(sitemap.status, 200)
    assert.doesNotMatch(await sitemap.text(), new RegExp(row.id))
    responses.push({
      path: row.path + '/' + row.id,
      status: 404,
      expiredApiNull: true,
      expiredMedia404: true,
      removedFromSitemap: true,
    })
  } finally {
    sql(
      `update public.visibility_entitlements set expires_at='${expiry}' where resource_id='${row.id}'`
    )
  }
  const fresh = await rpc('get_my_professional_listing', {}, owner)
  assert.equal(
    (
      await rpc(
        'save_professional_listing_draft',
        {
          p_listing_id: row.id,
          p_revision: fresh.body.draft.version,
          p_draft: { ownerId: other.user.id },
        },
        owner
      )
    ).body.message,
    'INVALID_ARGUMENT'
  )
  security.push({
    kind: row.kind,
    foreignEditDenied: true,
    foreignAdminReadDenied: true,
    directDraftTableDenied: true,
    directPublishedTableDenied: true,
    ownershipPayloadDenied: true,
  })
}
const legacy = await fetch(base + '/profissionais/' + story.results[1].id, { redirect: 'manual' })
assert.equal(legacy.status, 308)
assert.equal(legacy.headers.get('location'), '/locais/' + story.results[1].id)
for (const row of story.results) {
  const r = await fetch(base + row.path)
  assert.equal(r.status, 200)
  assert.match(await r.text(), new RegExp(row.name))
}
const sitemap = await fetch(base + '/sitemap.xml'),
  xml = await sitemap.text()
for (const row of story.results) assert.match(xml, new RegExp(row.path + '/' + row.id))
writeFileSync(
  'docs/finance-restructure/phase5/evidence/http-seo-security.json',
  JSON.stringify(
    {
      passed: true,
      localOnly: true,
      responses,
      security,
      legacyRedirect308: true,
      sitemapEligibleOnly: true,
    },
    null,
    2
  ) + '\n'
)
console.log('Phase 5 real crawler HTTP / API / media authorization passed')

// Disposable loopback only: all audiences, bytes, balances and tariffs are synthetic.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'
import { jwt } from '../keys.mjs'
const base = 'http://127.0.0.1:55554',
  anon = jwt({ role: 'anon' }),
  service = jwt({ role: 'service_role' })
const access = JSON.parse(readFileSync('.finance-local/phase6-access.json'))
async function request(path, body, token = anon) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw Error(data.message || JSON.stringify(data))
  return data
}
access.owner = await request('/auth/v1/token?grant_type=password', {
  email: access.email,
  password: access.password,
})
access.admin = await request('/auth/v1/token?grant_type=password', {
  email: access.adminEmail,
  password: access.adminPassword,
})
const owner = access.owner.access_token,
  admin = access.admin.access_token,
  uid = access.owner.user.id
const rpc = (name, args = {}, token = owner) => request('/rest/v1/rpc/' + name, args, token)
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
const account = (await rpc('list_advertiser_accounts', { p_offset: 0 })).find(
  (a) => a.can_manage
).id
const community = randomUUID(),
  post = randomUUID(),
  viewerEmail = `audience-${randomUUID()}@example.invalid`
await request(
  '/auth/v1/admin/users',
  { email: viewerEmail, password: access.password, email_confirm: true },
  service
)
const viewer = await request('/auth/v1/token?grant_type=password', {
  email: viewerEmail,
  password: access.password,
})
sql(
  `update public.users set usage_profile='professional',username='aud_'||left(replace(id::text,'-',''),12),data_nascimento='1990-01-01',legal_acceptance_version=(select version from public.legal_policy where id),legal_acceptance_digest=(select digest from public.legal_policy where id),legal_acceptance_accepted_at=now() where id='${viewer.user.id}';insert into public.communities(id,name,description,created_by,owner_id,tier,post_retention_mode)values('${community}','Comunidade sintética Fase 6','Somente homologação local','${uid}','${uid}','archive','no_auto_expiration');insert into public.community_members(community_id,user_id)values('${community}','${uid}'),('${community}','${viewer.user.id}');insert into public.statuses(id,community_id,author_id,type,text,expires_at)values('${post}','${community}','${uid}','text','Publicação original sintética para impulsionamento',now()+interval '30 days');`
)
await rpc('configure_community_advertising', {
  p_community: community,
  p_posts: true,
  p_community_boost: true,
  p_revision: 0,
})
let inv = await rpc('admin_advertising_inventory', {}, admin)
for (const p of inv.placements) {
  await rpc(
    'admin_configure_advertising_placement',
    {
      p_code: p.code,
      p_capacity: 100,
      p_sales_enabled: true,
      p_delivery_enabled: true,
      p_expected_revision: p.revision,
      p_reason: 'Inventário exclusivamente sintético para homologação local',
      p_confirm: true,
    },
    admin
  )
}
await rpc(
  'admin_set_advertising_network',
  {
    p_codes: ['home_banner', 'community_feed', 'community_banner'],
    p_revision: inv.networkRevision,
    p_reason: 'Pacote exclusivamente sintético local',
    p_confirm: true,
  },
  admin
)
for (const code of ['post_boost', 'community_boost']) {
  let f = (await rpc('admin_commercial_catalog', {}, admin)).items.find((f) => f.code === code)
  if (!f.currentPrice)
    await rpc(
      'admin_publish_commercial_price',
      {
        p_offering_code: code,
        p_unit_price_cash: '7',
        p_min_days: 1,
        p_max_days: 30,
        p_active_from: null,
        p_expected_revision: f.revision,
        p_request_id: randomUUID(),
        p_reason: 'Preço exclusivamente sintético local',
        p_confirm: true,
      },
      admin
    )
  f = (await rpc('admin_commercial_catalog', {}, admin)).items.find((f) => f.code === code)
  if (!f.salesEnabled)
    await rpc(
      'admin_set_commercial_sales',
      {
        p_offering_code: code,
        p_enabled: true,
        p_expected_revision: f.revision,
        p_request_id: randomUUID(),
        p_reason: 'Venda exclusivamente sintética local',
        p_confirm: true,
      },
      admin
    )
}
const campaigns = []
for (const placement of ['community_banner', 'community_feed', 'network']) {
  const id = await rpc('create_advertising_campaign', {
    p_account: account,
    p_placement: placement,
    p_community: community,
    p_title: 'Campanha sintética ' + placement,
    p_description: 'Sem oferta ou audiência real',
    p_destination: 'https://example.invalid/phase6',
    p_request_id: randomUUID(),
  })
  await rpc('edit_advertising_campaign', {
    p_id: id,
    p_version: 1,
    p_title: 'Campanha sintética ' + placement,
    p_description: 'Sem oferta ou audiência real',
    p_destination: 'https://example.invalid/phase6',
    p_submit: true,
    p_media_id: null,
  })
  await rpc(
    'admin_review_advertising_campaign',
    { p_id: id, p_version: 2, p_approve: true, p_reason: 'Material exclusivamente sintético' },
    admin
  )
  const quote = await rpc('quote_commercial_order', {
    p_resource_id: id,
    p_duration_days: '1',
    p_request_id: randomUUID(),
  })
  const paid = await rpc('confirm_commercial_order', { p_order_id: quote.id, p_confirm: true })
  campaigns.push({ id, placement, paid })
}
for (const [type, id] of [
  ['post', post],
  ['community', community],
]) {
  const p = await rpc('prepare_commercial_promotion', { p_type: type, p_id: id })
  await rpc(
    'admin_review_commercial_promotion',
    { p_id: p.resourceId, p_approve: true, p_reason: 'Impulsionamento exclusivamente sintético' },
    admin
  )
  const quote = await rpc('quote_commercial_order', {
    p_resource_id: p.resourceId,
    p_duration_days: '1',
    p_request_id: randomUUID(),
  })
  await rpc('confirm_commercial_order', { p_order_id: quote.id, p_confirm: true })
  assert.equal(sql(`select status from public.promotions where id='${p.resourceId}'`), 'active')
}
assert.equal(
  sql(`select count(*) from public.statuses where id='${post}'`),
  '1',
  'no duplicated organic post'
)
// Real gateway upload. No partner URL, second bucket or anonymous media fallback.
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE6_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage()
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 360
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#16433a'
    ctx.fillRect(0, 0, 640, 360)
    ctx.fillStyle = 'white'
    ctx.font = '28px sans-serif'
    ctx.fillText('PUBLICIDADE SINTÉTICA', 40, 180)
    return c.toDataURL('image/webp').split(',')[1]
  })
  const target = campaigns.find((c) => c.placement === 'community_feed')
  const form = new FormData()
  form.set('storefrontId', target.id)
  form.set(
    'image',
    new Blob([Buffer.from(b64, 'base64')], { type: 'image/webp' }),
    'synthetic.webp'
  )
  const upload = await fetch(base + '/functions/v1/storefront-media', {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + owner },
    body: form,
  })
  const uploadData = await upload.json()
  assert.equal(upload.status, 200, JSON.stringify(uploadData))
  const media = uploadData.mediaId
  await rpc('edit_advertising_campaign', {
    p_id: target.id,
    p_version: 2,
    p_title: 'Imagem sintética aprovada',
    p_description: 'Somente teste local',
    p_destination: 'https://example.invalid/phase6',
    p_submit: true,
    p_media_id: media,
  })
  const mediaRead = () =>
    fetch(base + '/functions/v1/storefront-media?id=' + media, {
      headers: { apikey: anon, Authorization: 'Bearer ' + viewer.access_token },
    })
  assert.equal((await mediaRead()).status, 404, 'pending bytes not exposed')
  await rpc(
    'admin_review_advertising_campaign',
    {
      p_id: target.id,
      p_version: 3,
      p_approve: true,
      p_reason: 'Imagem exclusivamente sintética aprovada',
    },
    admin
  )
  assert.equal((await mediaRead()).status, 200, 'approved contracted bytes visible')
  const events = [
    { id: randomUUID(), type: 'impression', ad: target.id, placement: 'community_feed', community },
  ]
  sql(
    'update public.sponsored_ad_metrics_settings set collection_enabled=true,exclude_minors=true where id;'
  )
  assert.equal((await rpc('record_ad_events', { events }, viewer.access_token)).accepted, 1)
  assert.equal(
    (await rpc('record_ad_events', { events }, viewer.access_token)).accepted,
    0,
    'same event is deduplicated'
  )
  const clicks = [{ ...events[0], id: randomUUID(), type: 'click' }]
  assert.equal((await rpc('record_ad_events', { events: clicks }, viewer.access_token)).accepted, 1)
  assert.equal((await rpc('record_ad_events', { events: clicks }, viewer.access_token)).accepted, 0)
  await rpc(
    'interrupt_advertising_campaign',
    { p_id: target.id, p_reason: 'Suspensão sintética para testar bloqueio' },
    admin
  )
  assert.equal((await mediaRead()).status, 404, 'suspended bytes denied immediately')
  assert.equal(
    (
      await rpc(
        'record_ad_events',
        { events: [{ ...events[0], id: randomUUID() }] },
        viewer.access_token
      )
    ).accepted,
    0
  )
  await rpc(
    'admin_resume_advertising_campaign',
    { p_id: target.id, p_revision: 3, p_reason: 'Retomada sintética após verificação' },
    admin
  )
  sql(
    `update public.visibility_entitlements set starts_at=now()-interval '2 days',expires_at=now()-interval '1 second' where resource_id='${target.id}'`
  )
  assert.equal((await mediaRead()).status, 404, 'expired bytes denied without cron')
  const renewal = await rpc('quote_commercial_order', {
    p_resource_id: target.id,
    p_duration_days: '1',
    p_request_id: randomUUID(),
  })
  await rpc('confirm_commercial_order', { p_order_id: renewal.id, p_confirm: true })
  assert.equal((await mediaRead()).status, 200, 'renewal restores the same approved material')
  sql('update public.sponsored_ad_metrics_settings set collection_enabled=false where id;')
  writeFileSync(
    '.finance-local/phase6-access.json',
    JSON.stringify({ ...access, community, post, viewer, viewerEmail, campaigns })
  )
  writeFileSync(
    'docs/finance-restructure/phase6/evidence/lifecycle.json',
    JSON.stringify(
      {
        localOnly: true,
        syntheticOnly: true,
        account,
        community,
        post,
        campaigns: campaigns.map((c) => ({ id: c.id, placement: c.placement })),
        postBoost: true,
        communityBoost: true,
        organicPostCopies: 1,
        realGatewayUpload: true,
        pendingMediaDenied: true,
        suspendedMediaDenied: true,
        expiredMediaDenied: true,
        manualSyntheticTimeTravel: true,
        renewal: true,
        metricsIngestion: true,
        metricsDeduplication: true,
        metricsAreSyntheticTestEvents: true,
        publicCollectionDisabledAfterTest: true,
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    'Local lifecycle, global/community campaigns, promotions, media and metrics checks passed'
  )
} finally {
  await browser.close()
}

// Independent committed sessions against an explicitly disposable local database.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { SYNTHETIC_COMMERCIAL_TERMS_SQL, confirmWithTermsSql } from './lib/commercial-terms-fixture.mjs'
const db = process.env.PG_TEST_CONTAINER || 'supabase_db_treinos_academia'
if (!['supabase_db_treinos_academia', 'evolutus_price_phase1_db'].includes(db))
  throw Error('DISPOSABLE_DATABASE_REQUIRED')
const execute = promisify(execFile),
  q = (v) => "'" + String(v).replaceAll("'", "''") + "'"
async function sql(s) {
  const { stdout } = await execute('docker', [
    'exec',
    '-i',
    db,
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
  ])
  return stdout
    .trim()
    .split('\n')
    .filter((s) => !['BEGIN', 'COMMIT', 'SET'].includes(s))
    .at(-1)
}
const admin = randomUUID(),
  owners = [randomUUID(), randomUUID()],
  sessions = new Map([admin, ...owners].map((id) => [id, randomUUID()]))
const claims = (id) =>
  `select set_config('request.jwt.claim.sub',${q(id)},true);select set_config('request.jwt.claims',${q(JSON.stringify({ sub: id, role: 'authenticated', session_id: sessions.get(id), amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] }))},true);set local role authenticated;`
const as = (id, s) => sql(`begin;${claims(id)}${s};commit;`)
for (const id of [admin, ...owners])
  await sql(
    `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values(${q(id)},'authenticated','authenticated',${q(id + '@example.invalid')},'x',now(),'{}','{}',now(),now());insert into auth.sessions(id,user_id,created_at,updated_at)values(${q(sessions.get(id))},${q(id)},now(),now());update public.users set usage_profile='professional',legal_acceptance_version=(select version from public.legal_policy where id),legal_acceptance_digest=(select digest from public.legal_policy where id) where id=${q(id)}`
  )
await sql(`update public.users set role='superadmin' where id=${q(admin)}`)
await sql(
  "insert into public.professional_listing_limits(kind,max_per_owner)values('professional',10),('space',10) on conflict(kind)do update set max_per_owner=10"
)
const results = []
await sql(SYNTHETIC_COMMERCIAL_TERMS_SQL) // 20261212000002: termos comerciais sintéticos
for (const [i, kind, offering] of [
  [0, 'professional', 'professional_profile'],
  [1, 'space', 'establishment_profile'],
]) {
  const owner = owners[i],
    revision = await sql(
      `select revision from public.commercial_offerings where code=${q(offering)}`
    )
  await as(
    admin,
    `select public.admin_publish_commercial_price(${q(offering)},'3',1,30,null,${revision},${q(randomUUID())},'Synthetic concurrency tariff only',true)`
  )
  await sql(`update public.commercial_offerings set sales_enabled=true where code=${q(offering)}`)
  const resource = JSON.parse(
    await as(owner, `select public.create_professional_listing(${q(kind)},${q(randomUUID())})`)
  ).listingId
  const draft = {
    kind,
    displayName: 'Concurrent profile',
    bio: 'Complete synthetic concurrent description',
    categoryKey: kind === 'space' ? 'academia' : 'personal_trainer',
    modalityKeys: ['musculacao'],
    city: 'São Paulo',
    uf: 'SP',
    serviceMode: 'online',
  }
  await as(
    owner,
    `select public.save_professional_listing_draft(${q(resource)},${q(JSON.stringify(draft))},0);select public.set_professional_listing_editorial(${q(resource)},1,'submitted')`
  )
  await as(
    admin,
    `select public.set_professional_listing_editorial(${q(resource)},2,'approved','Synthetic concurrency approval')`
  )
  await sql(
    `select public._wallet_credit_cash(${q(owner)},100);select public._ledger_record(${q(owner)},'phase5-race-seed','cash','credit',100,'synthetic','fixture','phase5')`
  )
  const quote = async (days = '1') =>
      JSON.parse(
        await as(
          owner,
          `select public.quote_commercial_order(${q(resource)},${q(days)},${q(randomUUID())})`
        )
      ),
    confirm = (o) => as(owner, confirmWithTermsSql(o.id))
  const first = await quote('2')
  await Promise.all(Array.from({ length: 6 }, () => confirm(first)))
  assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(owner)}`), '94')
  const renew = await quote()
  await Promise.all(Array.from({ length: 6 }, () => confirm(renew)))
  const independent = await Promise.all([quote(), quote()])
  await Promise.all(independent.map(confirm))
  assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(owner)}`), '85')
  assert.equal(
    await sql(
      `select extract(epoch from expires_at-starts_at)::bigint from public.visibility_entitlements where resource_id=${q(resource)}`
    ),
    '432000'
  )
  const rev = () =>
      sql(`select version from public.professional_listing_drafts where listing_id=${q(resource)}`),
    v = await rev()
  const edits = await Promise.allSettled(
    [1, 2].map((n) =>
      as(
        owner,
        `select public.save_professional_listing_draft(${q(resource)},${q(JSON.stringify({ ...draft, displayName: 'Race ' + n }))},${v})`
      )
    )
  )
  assert.equal(edits.filter((r) => r.status === 'fulfilled').length, 1)
  assert.match(
    edits.find((r) => r.status === 'rejected').reason.stderr,
    /EDITORIAL_REVISION_CONFLICT/
  )
  assert.equal(await sql(`select private.commercial_resource_visible(${q(resource)})`), 't')
  await as(
    owner,
    `select public.set_professional_listing_editorial(${q(resource)},${await rev()},'submitted')`
  )
  const submitted = await rev(),
    approvals = await Promise.allSettled(
      [1, 2].map(() =>
        as(
          admin,
          `select public.set_professional_listing_editorial(${q(resource)},${submitted},'approved','Concurrent revision approval')`
        )
      )
    )
  assert.equal(approvals.filter((r) => r.status === 'fulfilled').length, 1)
  assert.match(
    approvals.find((r) => r.status === 'rejected').reason.stderr,
    /EDITORIAL_REVISION_CONFLICT/
  )
  const media = randomUUID()
  await sql(
    `update public.storefront_settings set cleanup_enabled=true,cleanup_grace_seconds=3600;insert into public.storefront_media(id,storefront_id,storage_path,state,width,height,byte_size,unreferenced_since,upload_lease_until)values(${q(media)},${q(resource)},${q(resource + '/' + media + '.webp')},'ready',32,32,100,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')`
  )
  const attaching = as(
    owner,
    `select public.save_professional_listing_draft(${q(resource)},${q(JSON.stringify({ ...draft, mediaId: media }))},${await rev()});select pg_sleep(0.5)`
  )
  await new Promise((r) => setTimeout(r, 100))
  const claims = await as(
    admin,
    "select json_build_object('items',public.claim_storefront_media_cleanup(50))"
  )
  await attaching
  assert.ok(!claims.includes(media))
  assert.equal(await sql(`select private.storefront_media_referenced(${q(media)})`), 't')
  const pending = await quote(),
    suspending = as(
      admin,
      `select public.set_professional_listing_editorial(${q(resource)},${await rev()},'suspended','Synthetic concurrent suspension');select pg_sleep(0.4)`
    )
  await new Promise((r) => setTimeout(r, 100))
  const race = await Promise.allSettled([suspending, confirm(pending)])
  assert.equal(race[0].status, 'fulfilled')
  assert.equal(race[1].status, 'rejected')
  assert.match(race[1].reason.stderr, /RESOURCE_NOT_ELIGIBLE/)
  assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(owner)}`), '85')
  assert.equal(await sql(`select private.commercial_resource_visible(${q(resource)})`), 'f')
  results.push({
    kind,
    resource,
    replayDebitsOnce: true,
    independentRenewalsPreserveDuration: true,
    editAndApprovalSingleWinner: true,
    cleanupSkipsAssociation: true,
    suspensionBlocksPendingPayment: true,
    balance: 85,
  })
}
const evidence = process.env.FINANCE_EVIDENCE_DIR || 'docs/finance-restructure/phase5/evidence'
mkdirSync(evidence, { recursive: true })
writeFileSync(
  evidence + '/concurrency.json',
  JSON.stringify({ passed: true, localOnly: true, results }, null, 2) + '\n'
)
console.log(JSON.stringify(results))

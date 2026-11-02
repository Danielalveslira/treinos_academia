// Real committed races, local disposable database only; real concrete storefront adapter.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { SYNTHETIC_COMMERCIAL_TERMS_SQL, confirmWithTermsSql } from './lib/commercial-terms-fixture.mjs'
const container = process.env.PG_TEST_CONTAINER || 'supabase_db_treinos_academia'
if (!['supabase_db_treinos_academia', 'evolutus_price_phase1_db'].includes(container))
  throw Error('DISPOSABLE_DATABASE_REQUIRED')
const execute = promisify(execFile),
  q = (v) => "'" + String(v).replaceAll("'", "''") + "'"
async function sql(source) {
  const { stdout } = await execute('docker', [
    'exec',
    '-i',
    container,
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-X',
    '-tA',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    source,
  ])
  return (
    stdout
      .trim()
      .split('\n')
      .filter((s) => s.startsWith('{'))
      .at(-1) || stdout.trim()
  )
}
const owner = randomUUID(),
  admin = randomUUID(),
  sessions = new Map([owner, admin].map((id) => [id, randomUUID()]))
const claims = (id) =>
  `select set_config('request.jwt.claim.sub',${q(id)},true);select set_config('request.jwt.claims',${q(JSON.stringify({ sub: id, role: 'authenticated', session_id: sessions.get(id), amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] }))},true);set local role authenticated;`
const asUser = (id, source) => sql(`begin;${claims(id)}${source};commit;`)
for (const id of [owner, admin])
  await sql(
    `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values(${q(id)},'authenticated','authenticated',${q(id + '@example.invalid')},'x',now(),'{}','{}',now(),now());insert into auth.sessions(id,user_id,created_at,updated_at)values(${q(sessions.get(id))},${q(id)},now(),now());update public.users set legal_acceptance_version=(select version from public.legal_policy where id),legal_acceptance_digest=(select digest from public.legal_policy where id) where id=${q(id)}`
  )
await sql(
  `update public.users set role='superadmin' where id=${q(admin)};update public.storefront_settings set max_products=10,max_storefronts=3 where id`
)
// Explicit synthetic tariff in the disposable database only. CAS/version code is reused.
const revision = await sql(
  "select revision from public.commercial_offerings where code='product_storefront'"
)
await asUser(
  admin,
  `select public.admin_publish_commercial_price('product_storefront','3',1,30,null,${revision},${q(randomUUID())},'Synthetic concrete concurrency tariff',true)`
)
await sql(
  "update public.commercial_offerings set sales_enabled=true where code='product_storefront'"
)
const stores = []
for (let i = 0; i < 2; i++) {
  const id = await asUser(
    owner,
    `select json_build_object('id',public.create_product_storefront('Synthetic race ${i}',${q(randomUUID())}))`
  )
  // psql emits SET/COMMIT around scalar UUIDs, so find the actual UUID line.
  const resource = JSON.parse(id).id
  assert.ok(resource)
  const media = randomUUID()
  await sql(
    `insert into public.storefront_media(id,storefront_id,storage_path,state,width,height,byte_size)values(${q(media)},${q(resource)},${q(resource + '/' + media + '.webp')},'ready',32,32,100)`
  )
  await asUser(
    owner,
    `select public.save_product_storefront(${q(resource)},1,'Synthetic race ${i}','Complete synthetic race storefront','Contact');select public.save_storefront_product(${q(resource)},2,null,${q(JSON.stringify({ name: 'Synthetic item', brand: 'Brand', description: 'Synthetic race product', category: 'Fitness', storeUrl: 'https://example.invalid', mediaId: media }))}::jsonb);select public.set_storefront_editorial(${q(resource)},3,'submitted')`
  )
  await asUser(
    admin,
    `select public.set_storefront_editorial(${q(resource)},4,'approved','Synthetic concrete race approval')`
  )
  stores.push(resource)
}
await sql(
  `select public._wallet_credit_cash(${q(owner)},100);select public._ledger_record(${q(owner)},'race-seed','cash','credit',100,'synthetic','fixture','phase4')`
)
await sql(SYNTHETIC_COMMERCIAL_TERMS_SQL) // 20261212000002: termos comerciais sintéticos
const quote = async (id, days) =>
  JSON.parse(
    await asUser(
      owner,
      `select public.quote_commercial_order(${q(id)},${q(days)},${q(randomUUID())})`
    )
  )
const confirm = (o) => asUser(owner, confirmWithTermsSql(o.id))
const orders = await Promise.all(stores.map((id) => quote(id, '30')))
const race = await Promise.allSettled(orders.map(confirm))
assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1)
assert.match(
  race.find((r) => r.status === 'rejected').reason.stderr,
  /Saldo de EvoCash insuficiente/
)
const paid = JSON.parse(race.find((r) => r.status === 'fulfilled').value)
await Promise.all(Array.from({ length: 6 }, () => confirm(paid)))
assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(owner)}`), '10')
assert.equal(
  await sql(
    `select count(*) from public.economy_transactions where natural_key=${q('commercial:' + paid.id)} and user_id=${q(owner)}`
  ),
  '1'
)
const renew = await quote(paid.resourceId, '2')
await Promise.all(Array.from({ length: 6 }, () => confirm(renew)))
await sql(
  `select public._wallet_credit_cash(${q(owner)},10);select public._ledger_record(${q(owner)},'race-topup','cash','credit',10,'synthetic','fixture','phase4')`
)
const independent = await Promise.all([quote(paid.resourceId, '1'), quote(paid.resourceId, '1')])
await Promise.all(independent.map(confirm))
assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(owner)}`), '8')
assert.equal(
  await sql(
    `select extract(epoch from expires_at-starts_at)::bigint from public.visibility_entitlements where resource_id=${q(paid.resourceId)}`
  ),
  '2937600'
)
assert.equal(
  await sql(
    `select count(*) from public.visibility_entitlements where resource_id=${q(paid.resourceId)}`
  ),
  '1'
)
// Independent connections race CAS against the same draft; exactly one wins.
const revisionOf = () =>
  sql(`select draft_revision from public.product_storefronts where id=${q(paid.resourceId)}`)
const rev = await revisionOf()
const edits = await Promise.allSettled(
  [1, 2].map((i) =>
    asUser(
      owner,
      `select public.save_product_storefront(${q(paid.resourceId)},${rev},'Concurrent draft ${i}','Concurrent synthetic description','Contact')`
    )
  )
)
assert.equal(edits.filter((r) => r.status === 'fulfilled').length, 1)
assert.match(
  edits.find((r) => r.status === 'rejected').reason.stderr,
  /EDITORIAL_REVISION_CONFLICT/
)
assert.equal(await sql(`select private.commercial_resource_visible(${q(paid.resourceId)})`), 't')
await asUser(
  owner,
  `select public.set_storefront_editorial(${q(paid.resourceId)},${await revisionOf()},'submitted')`
)
const submitted = await revisionOf()
const approvals = await Promise.allSettled(
  [1, 2].map(() =>
    asUser(
      admin,
      `select public.set_storefront_editorial(${q(paid.resourceId)},${submitted},'approved','Concurrent synthetic approval')`
    )
  )
)
assert.equal(approvals.filter((r) => r.status === 'fulfilled').length, 1)
assert.match(
  approvals.find((r) => r.status === 'rejected').reason.stderr,
  /EDITORIAL_REVISION_CONFLICT/
)
// A cleanup worker must skip an anchor held by an in-flight association.
const cleanupMedia = randomUUID()
await sql(
  `update public.storefront_settings set cleanup_enabled=true,cleanup_grace_seconds=3600;insert into public.storefront_media(id,storefront_id,storage_path,state,width,height,byte_size,unreferenced_since,upload_lease_until)values(${q(cleanupMedia)},${q(paid.resourceId)},${q(paid.resourceId + '/' + cleanupMedia + '.webp')},'ready',32,32,100,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')`
)
const attachment = asUser(
  owner,
  `select public.save_product_storefront(${q(paid.resourceId)},${await revisionOf()},'Concurrent attached media','Description of attached media','Contact',${q(cleanupMedia)});select pg_sleep(0.5)`
)
await new Promise((r) => setTimeout(r, 100))
const cleanupClaims = await asUser(
  admin,
  `select json_build_object('items',public.claim_storefront_media_cleanup(50))`
)
await attachment
assert.ok(!JSON.stringify(JSON.parse(cleanupClaims)).includes(cleanupMedia))
assert.equal(await sql(`select private.storefront_media_referenced(${q(cleanupMedia)})`), 't')
assert.equal(
  await sql(`select state from public.storefront_media where id=${q(cleanupMedia)}`),
  'ready'
)
// Force moderation to acquire the anchor lock first, then race confirmation after it.
const pending = await quote(paid.resourceId, '1')
const suspension = asUser(
  admin,
  `select public.set_storefront_editorial(${q(paid.resourceId)},${await revisionOf()},'suspended','Synthetic concurrent security suspension');select pg_sleep(0.3)`
)
await new Promise((r) => setTimeout(r, 100))
const blocked = await Promise.allSettled([suspension, confirm(pending)])
assert.equal(blocked[0].status, 'fulfilled')
assert.equal(blocked[1].status, 'rejected')
assert.match(blocked[1].reason.stderr, /RESOURCE_NOT_ELIGIBLE/)
assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(owner)}`), '8')
assert.equal(await sql(`select private.commercial_resource_visible(${q(paid.resourceId)})`), 'f')
await sql(
  `update private.commercial_resources set moderation_state='archived' where id in(${stores.map(q).join(',')})`
)
const evidence = {
  passed: true,
  localOnly: true,
  concreteStorefronts: 2,
  concurrentEditsSingleWinner: true,
  concurrentApprovalsSingleWinner: true,
  cleanupSkipsConcurrentAssociation: true,
  competingOrders: 2,
  oneAffordableDebit: true,
  confirmationReplays: 6,
  renewalReplays: 6,
  independentConcurrentRenewals: 2,
  oneEntitlement: true,
  periodSeconds: 2937600,
  suspensionWinsPendingConfirmation: true,
  walletAfter: '8',
  fixtureOwner: owner,
}
const evidenceDir = process.env.FINANCE_EVIDENCE_DIR || 'docs/finance-restructure/phase4/evidence41'
mkdirSync(evidenceDir, { recursive: true })
writeFileSync(evidenceDir + '/concurrency.json', JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence))

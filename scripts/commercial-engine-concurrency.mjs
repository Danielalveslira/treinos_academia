import { verifyLocalPostgresImage } from './homolog/finance/images.mjs'
// Synthetic fixtures in an allowlisted disposable PostgreSQL only. No remote URL.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { SYNTHETIC_COMMERCIAL_TERMS_SQL, confirmWithTermsSql } from './lib/commercial-terms-fixture.mjs'
const container = process.env.PG_TEST_CONTAINER || 'supabase_db_treinos_academia'
if (!['supabase_db_treinos_academia', 'evolutus_price_phase1_db'].includes(container))
  throw Error('DISPOSABLE_DATABASE_REQUIRED')
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0]
verifyLocalPostgresImage(info)
const execute = promisify(execFile)
const q = (value) => `'${String(value).replaceAll("'", "''")}'`
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
      .filter((x) => x.startsWith('{'))
      .at(-1) || stdout.trim()
  )
}
const admin = randomUUID(),
  buyer = randomUUID(),
  other = randomUUID(),
  resource = randomUUID(),
  resource2 = randomUUID()
const code = 'synthetic_' + randomUUID().replaceAll('-', '')
const sessions = new Map([admin, buyer, other].map((x) => [x, randomUUID()]))
const claims = (user) =>
  `select set_config('request.jwt.claim.sub',${q(user)},true);select set_config('request.jwt.claims',${q(JSON.stringify({ sub: user, role: 'authenticated', session_id: sessions.get(user), amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] }))},true);set local role authenticated;`
const asUser = (user, source) => sql(`begin;${claims(user)}${source};commit;`)
for (const user of [admin, buyer, other])
  await sql(
    `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values(${q(user)},'authenticated','authenticated',${q(user + '@example.invalid')},'x',now(),'{}','{}',now(),now());insert into auth.sessions(id,user_id,created_at,updated_at)values(${q(sessions.get(user))},${q(user)},now(),now());update public.users set legal_acceptance_version=(select version from public.legal_policy where id),legal_acceptance_digest=(select digest from public.legal_policy where id) where id=${q(user)}`
  )
await sql(
  `update public.users set role='superadmin' where id=${q(admin)};insert into public.commercial_offerings(code,name,description,integration_ready)values(${q(code)},'Synthetic concurrency','Synthetic fixture only',true)`
)
const publish = (price, revision) =>
  asUser(
    admin,
    `select public.admin_publish_commercial_price(${q(code)},${q(price)},1,30,null,${revision},${q(randomUUID())},'Synthetic concurrency price',true)`
  )
const race = await Promise.allSettled([publish('70', 0), publish('70', 0)])
assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1)
assert.match(race.find((x) => x.status === 'rejected').reason.stderr, /PRICE_REVISION_CONFLICT/)
await asUser(
  admin,
  `select public.admin_set_commercial_sales(${q(code)},true,1,${q(randomUUID())},'Synthetic enable only',true)`
)
await sql(
  `insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)values(${q(resource)},${q(code)},${q(buyer)},1,1,'approved'),(${q(resource2)},${q(code)},${q(buyer)},1,1,'approved');select public._wallet_credit_cash(${q(buyer)},100);select public._ledger_record(${q(buyer)},'synthetic','cash','credit',100,'synthetic','fixture',${q(code)})`
)
await sql(SYNTHETIC_COMMERCIAL_TERMS_SQL) // 20261212000002: termos comerciais sintéticos
const quote = async (r, days = '1') =>
  JSON.parse(
    await asUser(
      buyer,
      `select public.quote_commercial_order(${q(r)},${q(days)},${q(randomUUID())})`
    )
  )
const confirm = (o) => asUser(buyer, confirmWithTermsSql(o.id))
const [a, b] = await Promise.all([quote(resource), quote(resource2)])
const spend = await Promise.allSettled([confirm(a), confirm(b)])
assert.equal(
  spend.filter((x) => x.status === 'fulfilled').length,
  1,
  'Only one order fits the same wallet'
)
assert.match(
  spend.find((x) => x.status === 'rejected').reason.stderr,
  /Saldo de EvoCash insuficiente/
)
assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(buyer)}`), '30')
const paid = JSON.parse(spend.find((x) => x.status === 'fulfilled').value)
const replays = await Promise.all(Array.from({ length: 6 }, () => confirm(paid)))
assert.equal(new Set(replays).size, 1)
assert.equal(
  await sql(
    `select count(*) from public.economy_transactions where reference_id=${q(paid.id)} and direction='debit'`
  ),
  '1'
)
await publish('2', 2)
const renew = await quote(paid.resourceId, '2')
await Promise.all(Array.from({ length: 6 }, () => confirm(renew)))
assert.equal(
  await sql(
    `select count(*) from public.economy_transactions where reference_id=${q(renew.id)} and direction='debit'`
  ),
  '1'
)
const renewals = await Promise.all([quote(paid.resourceId, '1'), quote(paid.resourceId, '1')])
await Promise.all(renewals.map(confirm))
assert.equal(
  await sql(
    `select extract(epoch from expires_at-starts_at)::bigint from public.visibility_entitlements where resource_id=${q(paid.resourceId)}`
  ),
  '432000',
  'Exactly five days after one initial plus idempotent two-day plus two one-day renewals'
)
assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(buyer)}`), '22')
assert.equal(
  await sql(
    `select count(*) from public.visibility_entitlements where resource_id=${q(paid.resourceId)}`
  ),
  '1'
)
await asUser(
  admin,
  `select public.admin_set_commercial_sales(${q(code)},false,3,${q(randomUUID())},'Synthetic pause after test',true)`
)
const evidence = {
  passed: true,
  localOnly: true,
  concurrentPricePublishers: 2,
  onePublisher: true,
  competingWalletOrders: 2,
  oneAffordableDebit: true,
  confirmationReplays: 6,
  renewalReplays: 6,
  independentConcurrentRenewals: 2,
  oneEntitlement: true,
  exactPeriodSeconds: 432000,
  salesPausedAfterTest: true,
  fixtureCode: code,
}
mkdirSync('docs/finance-restructure/phase3/evidence', { recursive: true })
writeFileSync(
  'docs/finance-restructure/phase3/evidence/concurrency.json',
  JSON.stringify(evidence, null, 2) + '\n'
)
console.log(JSON.stringify(evidence))

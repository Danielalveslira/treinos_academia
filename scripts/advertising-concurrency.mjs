import { verifyLocalPostgresImage } from './homolog/finance/images.mjs'
// Synthetic fixtures in an allowlisted disposable PostgreSQL only. No remote URL.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { SYNTHETIC_COMMERCIAL_TERMS_SQL, confirmWithTermsSql } from './lib/commercial-terms-fixture.mjs'
const container = process.env.PG_TEST_CONTAINER || 'supabase_db_treinos_academia'
if (!['supabase_db_treinos_academia', 'evolutus_price_phase1_db', 'evolutus_integrated_db', 'evolutus_release_ci_db'].includes(container))
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
  other = randomUUID()
const sessions = new Map([admin, buyer, other].map((x) => [x, randomUUID()]))
const claims = (user) =>
  `select set_config('request.jwt.claim.sub',${q(user)},true);select set_config('request.jwt.claims',${q(JSON.stringify({ sub: user, role: 'authenticated', session_id: sessions.get(user), amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] }))},true);set local role authenticated;`
const asUser = (user, source) => sql(`begin;${claims(user)}${source};commit;`)
const code = 'synthetic_' + randomUUID().replaceAll('-', '')
const p1 = code + '_a',
  p2 = code + '_b'
const context = '00000000-0000-0000-0000-000000000000'
const resources = [randomUUID(), randomUUID(), randomUUID()]
for (const user of [admin, buyer, other])
  await sql(
    `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values(${q(user)},'authenticated','authenticated',${q(user + '@example.invalid')},'x',now(),'{}','{}',now(),now());insert into auth.sessions(id,user_id,created_at,updated_at)values(${q(sessions.get(user))},${q(user)},now(),now())`
  )
await sql(`update public.users set usage_profile='professional',legal_acceptance_version=(select version from public.legal_policy where id),legal_acceptance_digest=(select digest from public.legal_policy where id) where id in(${q(admin)},${q(buyer)},${q(other)});update public.users set role='superadmin' where id=${q(admin)};insert into public.commercial_offerings(code,name,description,integration_ready)values(${q(code)},'Synthetic advertising concurrency','Isolated interval inventory test',true);
insert into public.advertising_placements(code,name,description,surface,content_type,offering_code,sales_enabled,delivery_enabled,capacity)values(${q(p1)},'Synthetic slot A','Synthetic slot A only','home','banner',${q(code)},true,true,1),(${q(p2)},'Synthetic slot B','Synthetic slot B only','home','banner',${q(code)},true,true,1);`)
await asUser(
  admin,
  `select public.admin_publish_commercial_price(${q(code)},'7',1,30,null,0,${q(randomUUID())},'Synthetic concurrency price',true);select public.admin_set_commercial_sales(${q(code)},true,1,${q(randomUUID())},'Synthetic enable only',true)`
)
for (let i = 0; i < resources.length; i++)
  await sql(
    `insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)values(${q(resources[i])},${q(code)},${q(i === 1 ? other : buyer)},1,1,'approved');insert into private.advertising_resource_inventory values(${q(resources[i])},${q(i === 2 ? p2 : p1)},${q(context)})`
  )
for (const u of [buyer, other])
  await sql(
    `select public._wallet_credit_cash(${q(u)},100);select public._ledger_record(${q(u)},'synthetic-ads-seed','cash','credit',100,'synthetic','fixture',${q(code)})`
  )
await sql(SYNTHETIC_COMMERCIAL_TERMS_SQL) // 20261212000002: termos comerciais sintéticos
const quote = async (i, days = '1') =>
  JSON.parse(
    await asUser(
      i === 1 ? other : buyer,
      `select public.quote_commercial_order(${q(resources[i])},${q(days)},${q(randomUUID())})`
    )
  )
const confirm = (o, u = buyer) =>
  asUser(u, confirmWithTermsSql(o.id))
const [a, b] = await Promise.all([quote(0), quote(1)])
const race = await Promise.allSettled([confirm(a), confirm(b, other)])
assert.equal(
  race.filter((r) => r.status === 'fulfilled').length,
  1,
  'exactly one buyer wins the last slot'
)
assert.match(race.find((r) => r.status === 'rejected').reason.stderr, /AD_CAPACITY_UNAVAILABLE/)
const paid = JSON.parse(race.find((r) => r.status === 'fulfilled').value)
const winner = paid.resourceId === resources[0] ? buyer : other
assert.equal(
  await sql(
    `select count(*) from public.economy_transactions where reference_id in(${q(a.id)},${q(b.id)}) and direction='debit'`
  ),
  '1',
  'loser has no isolated debit'
)
const replay = await Promise.all(Array.from({ length: 6 }, () => confirm(paid, winner)))
assert.equal(new Set(replay).size, 1)
assert.equal(
  await sql(`select count(*) from private.advertising_reservations where order_id=${q(paid.id)}`),
  '1',
  'replay does not duplicate capacity'
)
// Independent renewals serialize on the same resource and append exact 24-hour periods.
const wi = winner === buyer ? 0 : 1
const renewals = await Promise.all([quote(wi), quote(wi)])
await Promise.all(renewals.map((o) => confirm(o, winner)))
assert.equal(
  await sql(
    `select extract(epoch from expires_at-starts_at)::bigint from public.visibility_entitlements where resource_id=${q(paid.resourceId)}`
  ),
  '259200'
)
// Capacity reduction competes for the same placement lock and cannot invalidate commitments.
const reduction = await Promise.allSettled([
  asUser(
    admin,
    `select public.admin_configure_advertising_placement(${q(p1)},0,false,true,0,'Synthetic concurrent reduction',true)`
  ),
  quote(wi),
])
assert.equal(reduction[0].status, 'rejected')
assert.match(reduction[0].reason.stderr, /AD_CAPACITY_COMMITTED/)
// Global resource requires BOTH slots. Slot A is occupied; slot B must not be reserved or charged.
await sql(
  `insert into private.advertising_resource_inventory values(${q(resources[2])},${q(p1)},${q(context)})`
)
const before = await sql(`select cash_balance from public.wallets where user_id=${q(buyer)}`)
const global = await Promise.allSettled([quote(2)])
assert.equal(global[0].status, 'rejected')
assert.match(global[0].reason.stderr, /AD_CAPACITY_UNAVAILABLE/)
assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(buyer)}`), before)
assert.equal(
  await sql(
    `select count(*) from private.advertising_reservations r join public.commercial_orders o on o.id=r.order_id where o.resource_id=${q(resources[2])}`
  ),
  '0'
)
// Material editorial publication competes with confirmation on the same resource lock.
const reviewResource = randomUUID()
await sql(
  `insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)values(${q(reviewResource)},${q(code)},${q(buyer)},1,1,'approved');insert into private.advertising_resource_inventory values(${q(reviewResource)},${q(p2)},${q(context)})`
)
const reviewQuote = JSON.parse(
  await asUser(
    buyer,
    `select public.quote_commercial_order(${q(reviewResource)},'1',${q(randomUUID())})`
  )
)
await sql(
  `update private.commercial_resources set content_revision=2,approved_revision=2 where id=${q(reviewResource)}`
)
const changed = await Promise.allSettled([confirm(reviewQuote)])
assert.equal(changed[0].status, 'rejected')
assert.match(changed[0].reason.stderr, /RESOURCE_NOT_ELIGIBLE/)
assert.equal(
  await sql(
    `select count(*) from public.economy_transactions where reference_id=${q(reviewQuote.id)}`
  ),
  '0'
)
// Both confirmations compete for the same personal balance, across independent slots.
const poor = randomUUID(),
  poorSession = randomUUID()
sessions.set(poor, poorSession)
await sql(
  `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values(${q(poor)},'authenticated','authenticated',${q(poor + '@example.invalid')},'x',now(),'{}','{}',now(),now());insert into auth.sessions(id,user_id,created_at,updated_at)values(${q(poorSession)},${q(poor)},now(),now());update public.users set usage_profile='professional',legal_acceptance_version=(select version from public.legal_policy where id),legal_acceptance_digest=(select digest from public.legal_policy where id) where id=${q(poor)};select public._wallet_credit_cash(${q(poor)},7);select public._ledger_record(${q(poor)},'synthetic-balance-seed','cash','credit',7,'synthetic','fixture',${q(code)});`
)
const extra = [
  code + '_balance',
  code + '_global_a',
  code + '_global_b',
  code + '_suspend',
  code + '_capacity',
]
for (const placement of extra)
  await sql(
    `insert into public.advertising_placements(code,name,description,surface,content_type,offering_code,sales_enabled,delivery_enabled,capacity)values(${q(placement)},'Synthetic additional slot','Only isolated concurrency fixtures','home','banner',${q(code)},true,true,${placement.endsWith('_balance') ? 4 : 1})`
  )
async function resource(user, placements) {
  const id = randomUUID()
  await sql(
    `insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)values(${q(id)},${q(code)},${q(user)},1,1,'approved');insert into private.advertising_resource_inventory(resource_id,placement_code,context_id) values ${placements.map((p) => `(${q(id)},${q(p)},${q(context)})`).join(',')}`
  )
  return id
}
async function quoteFor(id, user = buyer) {
  return JSON.parse(
    await asUser(user, `select public.quote_commercial_order(${q(id)},'1',${q(randomUUID())})`)
  )
}
const balanceResources = await Promise.all([resource(poor, [extra[0]]), resource(poor, [extra[0]])])
const balanceQuotes = await Promise.all(balanceResources.map((id) => quoteFor(id, poor)))
const balanceRace = await Promise.allSettled(balanceQuotes.map((o) => confirm(o, poor)))
assert.equal(balanceRace.filter((r) => r.status === 'fulfilled').length, 1)
assert.match(
  balanceRace.find((r) => r.status === 'rejected').reason.stderr,
  /Saldo de EvoCash insuficiente/
)
assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(poor)}`), '0')
// Real multi-placement race: the loser must reserve neither required position.
const globalResources = await Promise.all([
  resource(buyer, [extra[1], extra[2]]),
  resource(other, [extra[1], extra[2]]),
])
const globalQuotes = await Promise.all(
  globalResources.map((id, i) => quoteFor(id, i ? other : buyer))
)
const globalRace = await Promise.allSettled(
  globalQuotes.map((o, i) => confirm(o, i ? other : buyer))
)
assert.equal(globalRace.filter((r) => r.status === 'fulfilled').length, 1)
assert.match(
  globalRace.find((r) => r.status === 'rejected').reason.stderr,
  /AD_CAPACITY_UNAVAILABLE/
)
assert.equal(
  await sql(
    `select count(*) from private.advertising_reservations where order_id in(${globalQuotes.map((o) => q(o.id)).join(',')})`
  ),
  '2'
)
// Suspension and confirmation use the identical resource lock. Either serial order
// is safe: suspension never grants more time or removes the financial history.
const suspendedResource = await resource(buyer, [extra[3]])
const suspendedQuote = await quoteFor(suspendedResource)
const suspension = await Promise.allSettled([
  sql(
    `begin;select 1 from private.commercial_resources where id=${q(suspendedResource)} for update;update private.commercial_resources set moderation_state='suspended' where id=${q(suspendedResource)};commit;`
  ),
  confirm(suspendedQuote),
])
assert.equal(suspension[0].status, 'fulfilled')
assert.equal(await sql(`select private.commercial_resource_visible(${q(suspendedResource)})`), 'f')
assert.equal(
  await sql(
    `select count(*) from public.economy_transactions t where t.reference_id=${q(suspendedQuote.id)} and not exists(select 1 from public.commercial_orders o where o.id=t.reference_id::uuid and o.status='fulfilled')`
  ),
  '0'
)
// Capacity can be reduced only before a reservation commits. It cannot invalidate
// an order when the competing confirmation acquired the placement lock first.
const capacityResource = await resource(buyer, [extra[4]])
const capacityQuote = await quoteFor(capacityResource)
const capacityRace = await Promise.allSettled([
  confirm(capacityQuote),
  asUser(
    admin,
    `select public.admin_configure_advertising_placement(${q(extra[4])},0,false,true,0,'Synthetic competing capacity change',true)`
  ),
])
assert.equal(capacityRace.filter((r) => r.status === 'fulfilled').length, 1)
const peak = Number(
  await sql(`select private.advertising_peak(${q(extra[4])},${q(context)},now(),'infinity')`)
)
const cap = Number(
  await sql(`select capacity from public.advertising_placements where code=${q(extra[4])}`)
)
assert.ok(peak <= cap)
// Price publication competes with quoting; whichever version the quote observes
// is frozen and remains the only amount debited by its later confirmation.
const priceResource = await resource(buyer, [extra[0]])
const priceRace = await Promise.all([
  quoteFor(priceResource),
  asUser(
    admin,
    `select public.admin_publish_commercial_price(${q(code)},'8',1,30,null,2,${q(randomUUID())},'Synthetic price race only',true)`
  ),
])
const pricePaid = JSON.parse(await confirm(priceRace[0]))
assert.equal(pricePaid.totalCash, priceRace[0].totalCash)
// Synthetic history is retained, then sales and delivery are paused. No production data.
await sql(
  `update public.commercial_offerings set sales_enabled=false where code=${q(code)};update public.advertising_placements set sales_enabled=false,delivery_enabled=false where code in(${[p1, p2, ...extra].map(q).join(',')})`
)
const result = {
  localOnly: true,
  container,
  offering: code,
  lastSlotRace: true,
  sixReplays: true,
  simultaneousRenewals: true,
  capacityReduction: true,
  globalAtomicity: true,
  editorialRevisionGuard: true,
  sameBalanceRace: true,
  globalLastSlotRace: true,
  suspensionDuringPayment: true,
  capacityDuringReservation: true,
  priceDuringQuote: true,
  isolatedDebitCount: 0,
}
mkdirSync('docs/finance-restructure/phase6/evidence', { recursive: true })
writeFileSync(
  'docs/finance-restructure/phase6/evidence/concurrency.json',
  JSON.stringify(result, null, 2) + '\n'
)
console.log(JSON.stringify(result))

// New pricing invariants only, against explicit disposable targets. No remote DB URL.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { SYNTHETIC_COMMERCIAL_TERMS_SQL, acceptCashQuoteTermsSql } from './lib/commercial-terms-fixture.mjs'
const container = process.env.PG_TEST_CONTAINER || 'supabase_db_treinos_academia'
if (!['supabase_db_treinos_academia', 'evolutus_commercial_phase0_20261027'].includes(container)) throw Error('DISPOSABLE_DATABASE_REQUIRED')
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0]
assert.match(info.Config.Image, /supabase\/postgres:/)
const execute = promisify(execFile)
async function sql(source) {
  const result = await execute('docker', ['exec', '-i', container, 'psql', '-U', process.env.PG_TEST_USER || 'supabase_admin', '-d', 'postgres', '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', source])
  const text = result.stdout.trim()
  return text.split('\n').filter(line => line.startsWith('{')).at(-1) || text
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const admin = randomUUID(), buyer = randomUUID(), adminSession = randomUUID(), buyerSession = randomUUID()
function claims(user, session) {
  const payload = JSON.stringify({ sub: user, role: 'authenticated', session_id: session, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] })
  return `select set_config('request.jwt.claim.sub',${quote(user)},true);select set_config('request.jwt.claims',${quote(payload)},true);set local role authenticated;`
}
const config = price => JSON.stringify({ unitPriceCentavos: String(price), minimumUnitPriceCentavos: '1', minQuantity: '1', maxQuantity: '1000', dailyQuantityLimit: '2000', totalQuantityLimit: '10000', quoteTtlSeconds: '300', largeChangeThresholdBps: '2000' })
const publish = (price, revision, requestId) => `begin;${claims(admin,adminSession)}select public.admin_publish_evocash_price(${quote(config(price))}::jsonb,null,${revision},${quote(requestId)},'Synthetic concurrent price',true);commit;`
const createQuote = requestId => `begin;${claims(buyer,buyerSession)}select public.create_evocash_purchase_quote('25',${quote(requestId)});commit;`
const state = JSON.parse(await sql(`select jsonb_build_object('revision',revision,'latest',latest_version_id) from public.evocash_pricing_state where id`))
// Existing synthetic versions may remain from a previous run; revision CAS still applies.
await sql(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
(${quote(admin)},'authenticated','authenticated',${quote(admin+'@example.invalid')},'x',now(),'{}','{}',now(),now()),
(${quote(buyer)},'authenticated','authenticated',${quote(buyer+'@example.invalid')},'x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id=${quote(admin)};
insert into auth.sessions(id,user_id,created_at,updated_at) values(${quote(adminSession)},${quote(admin)},now(),now()),(${quote(buyerSession)},${quote(buyer)},now(),now());`)
const moneySnapshot = () => sql(`select jsonb_build_object('purchases',(select count(*) from public.cash_purchases),'ledger',(select count(*) from public.economy_transactions),'cash',(select coalesce(sum(cash_balance),0) from public.wallets))`)
const before = await moneySnapshot()
await sql(publish(10, state.revision, randomUUID()))
const races = await Promise.allSettled([11,12,13,14].map(price => sql(publish(price,state.revision+1,randomUUID()))))
assert.equal(races.filter(r=>r.status==='fulfilled').length,1, 'Exactly one compare-and-swap publisher wins')
for (const r of races.filter(r=>r.status==='rejected')) assert.match(r.reason.stderr,/PRICE_REVISION_CONFLICT/)
const requestId = randomUUID()
const replays = await Promise.all(Array.from({length:6},()=>sql(publish(15,state.revision+2,requestId))))
assert.equal(new Set(replays).size,1,'Publication retries return the same response')
assert.equal(await sql(`select count(*) from public.evocash_price_audit where actor_user_id=${quote(admin)} and request_id=${quote(requestId)}`),'1')
await sql('update public.evocash_pricing_state set quoting_enabled=true where id')
await sql("update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', true)) where id")
const quoteRequest = randomUUID()
const quotes = await Promise.all(Array.from({length:6},()=>sql(createQuote(quoteRequest))))
assert.equal(new Set(quotes).size,1,'Concurrent quote replays share one frozen quote')
const mixed = await Promise.allSettled([sql(publish(16,state.revision+3,randomUUID())), ...Array.from({length:6},()=>sql(createQuote(randomUUID())))])
assert.equal(mixed.filter(r=>r.status==='rejected').length,0)
assert.equal(await sql(`select count(*) from public.evocash_purchase_quotes q join public.evocash_price_versions v on v.id=q.price_version_id where q.user_id=${quote(buyer)} and (q.unit_price_centavos<>v.unit_price_centavos or q.total_centavos<>q.quantity*v.unit_price_centavos)`),'0','No quote mixes two prices across publication race')
assert.equal(await moneySnapshot(),before,'Concurrent pricing cannot change balances, ledger or purchases')

// Phase 2: quote reservation and confirmation reuse the existing ledger atomically.
await sql('update public.evocash_pricing_state set checkout_enabled=true where id')
await sql(SYNTHETIC_COMMERCIAL_TERMS_SQL) // 20261212000002: Condições do EvoCash sintéticas
const phase2Quote = JSON.parse((await sql(createQuote(randomUUID())))).quoteId
await sql(`begin;${claims(buyer,buyerSession)}${acceptCashQuoteTermsSql(phase2Quote)};commit;`)
const checkoutId=randomUUID()
const reserve = quoteId=>`begin;${claims(buyer,buyerSession)}select public.reserve_infinitepay_cash_purchase(${quote(quoteId)},${quote(checkoutId)});commit;`
const orders=await Promise.all(Array.from({length:6},()=>sql(reserve(phase2Quote))))
const parsedOrders=orders.map(JSON.parse)
assert.equal(new Set(parsedOrders.map(o=>o.id)).size,1,'Concurrent checkout retries share one order')
assert.equal(parsedOrders.filter(o=>o.createLink).length,1,'Exactly one caller may create a provider link')
const order=parsedOrders[0]
const confirmation=`select public.confirm_infinitepay_cash_purchase(${quote(order.id)},${quote(order.orderNsu)},'phase2-'||${quote(order.id)},'invoice-'||${quote(order.id)},${order.amountCentavos},'pix',null);`
await Promise.all(Array.from({length:6},()=>sql(confirmation)))
assert.equal(await sql(`select count(*) from public.economy_transactions where reference_type='cash_purchase' and reference_id=${quote(order.id)}`),'1')
assert.equal(await sql(`select cash_balance from public.wallets where user_id=${quote(buyer)}`),'25')
await sql('update public.evocash_pricing_state set quoting_enabled=false,checkout_enabled=false where id')
console.log(JSON.stringify({passed:true,localOnly:true,publishRace:{attempts:4,winners:1},publicationReplays:6,quoteReplays:6,publicationQuoteRace:7,checkoutReplays:6,oneLinkCreator:true,confirmationReplays:6,oneLedgerCredit:true,quotingPausedAfterTest:true,fixturesRetainedInDisposableDatabase:true}))

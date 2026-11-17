// Real two-session race against an isolated local PostgreSQL fixture. Never accepts a remote DB.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { verifyLocalPostgresImage } from './homolog/finance/images.mjs'

const container = process.env.PG_TEST_CONTAINER || 'hdb'
if (!['hdb', 'evolutus_pr152_db', 'supabase_db_treinos_academia', 'evolutus_integrated_db'].includes(container))
  throw new Error('LOCAL_DATABASE_REQUIRED')
verifyLocalPostgresImage(
  JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0]
)
const exec = promisify(execFile)
const q = (value) => `'${String(value).replaceAll("'", "''")}'`
async function sql(source) {
  const { stdout } = await exec('docker', [
    'exec',
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
  return stdout.trim().split('\n').at(-1)
}

const user = randomUUID()
const session = randomUUID()
const account = randomUUID()
const ad = randomUUID()
const placement = 'pause_race_' + randomUUID().replaceAll('-', '')
const order = randomUUID()
const price = randomUUID()
const claims = JSON.stringify({ sub: user, role: 'authenticated', session_id: session })
const asOwner = (source) =>
  sql(`begin;
  select set_config('request.jwt.claim.sub',${q(user)},true);
  select set_config('request.jwt.claims',${q(claims)},true);
  set local role authenticated;
  ${source}; commit;`)

await sql(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(${q(user)},'authenticated','authenticated',${q(user + '@example.invalid')},'x',now(),'{}','{}',now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(${q(session)},${q(user)},now(),now());
  update public.users set legal_acceptance_version=(select version from public.legal_policy where id),
    legal_acceptance_digest=(select digest from public.legal_policy where id) where id=${q(user)};
  insert into public.advertiser_accounts(id,name,created_by,owner_user_id)
    values(${q(account)},'Synthetic pause race',${q(user)},${q(user)});
  insert into public.advertiser_members(account_id,user_id,permission,granted_by)
    values(${q(account)},${q(user)},'owner',${q(user)});
  insert into public.sponsored_ads(id,partner_name,title,created_by,display_mode,is_global)
    values(${q(ad)},'Synthetic','Concurrent pause',${q(user)},array['banner'],true);
  insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,
    approved_revision,moderation_state) values(${q(ad)},'ad_home',${q(user)},1,1,'approved');
  update public.sponsored_ads set commercial_resource_id=${q(ad)} where id=${q(ad)};
  insert into private.advertising_drafts(ad_id,account_id,version,state,title,destination,
    creation_request,approved_version) values(${q(ad)},${q(account)},1,'approved',
    'Concurrent pause','https://example.invalid/pause-race','{}',1);
  insert into public.advertising_placements(code,name,description,surface,content_type,
    offering_code,sales_enabled,delivery_enabled,capacity) values(${q(placement)},'Synthetic pause slot',
    'Isolated slot for a local concurrency test','home','banner','ad_home',true,true,1);
  insert into private.advertising_resource_inventory(resource_id,placement_code,context_id)
    values(${q(ad)},${q(placement)},'00000000-0000-0000-0000-000000000000');
  insert into public.commercial_price_versions(id,offering_code,revision,unit_price_cash,
    min_days,max_days,active_from,created_by,reason)
    select ${q(price)},'ad_home',coalesce(max(revision),0)+1,7,1,30,
      clock_timestamp(),${q(user)},'Synthetic pause race price'
    from public.commercial_price_versions where offering_code='ad_home';
  insert into public.commercial_orders(id,payer_user_id,request_id,resource_id,offering_code,
    price_version_id,content_revision,duration_days,unit_price_cash,total_cash,status,
    quote_expires_at,fulfilled_at,period_start,period_end)
    values(${q(order)},${q(user)},gen_random_uuid(),${q(ad)},'ad_home',${q(price)},
      1,2,7,14,'fulfilled',now()+interval '1 hour',now()-interval '1 hour',
      now()-interval '1 hour',now()-interval '1 hour'+interval '2 days');
  insert into public.visibility_entitlements(resource_id,origin_order_id,starts_at,expires_at,
    administrative_state) values(${q(ad)},${q(order)},now()-interval '1 hour',
    now()-interval '1 hour'+interval '2 days','enabled')`)

const before = await sql(
  `select expires_at::text from public.visibility_entitlements where resource_id=${q(ad)}`
)
const cashBefore = await sql(
  `select coalesce((select cash_balance from public.wallets where user_id=${q(user)}),0)`
)
await Promise.all([
  asOwner(`select public.interrupt_advertising_campaign(${q(ad)},'Concurrent first pause',gen_random_uuid())`),
  asOwner(`select public.interrupt_advertising_campaign(${q(ad)},'Concurrent duplicate pause',gen_random_uuid())`),
])
assert.equal(
  await sql(`select advertiser_pause_count from private.commercial_resources where id=${q(ad)}`),
  '1'
)
assert.equal(
  await sql(
    `select count(*) from public.advertising_operations where resource_id=${q(ad)} and action='advertiser_pause'`
  ),
  '1'
)

// The same race at the exhausted limit must create exactly one suspension operation.
await asOwner(`select public.resume_my_advertising_campaign(${q(ad)},gen_random_uuid())`)
await sql(`update private.commercial_resources set advertiser_pause_count=3,
  advertiser_pause_period_start=(select starts_at from public.visibility_entitlements where resource_id=${q(ad)})
  where id=${q(ad)}`)
await Promise.all([
  asOwner(
    `select public.interrupt_advertising_campaign(${q(ad)},'Concurrent fourth pause A',gen_random_uuid())`
  ).then(
    () => assert.fail('unconfirmed suspension'),
    (error) => assert.match(error.message, /AD_PAUSE_LIMIT_CONFIRM_REQUIRED/)
  ),
  asOwner(
    `select public.interrupt_advertising_campaign(${q(ad)},'Concurrent fourth pause B',gen_random_uuid())`
  ).then(
    () => assert.fail('unconfirmed suspension'),
    (error) => assert.match(error.message, /AD_PAUSE_LIMIT_CONFIRM_REQUIRED/)
  ),
])
assert.equal(
  await sql(`select moderation_state from private.commercial_resources where id=${q(ad)}`),
  'approved'
)
const period = await sql(
  `select starts_at::text from public.visibility_entitlements where resource_id=${q(ad)}`
)
const revision = await sql(
  `select approved_revision from private.commercial_resources where id=${q(ad)}`
)
const operation = await sql(
  `select id from public.advertising_operations where resource_id=${q(ad)} order by id desc limit 1`
)
await asOwner(
  `select public.confirm_advertising_pause_limit(${q(ad)},${q(period)},${revision},${operation},'Confirmed fourth pause')`
)
assert.equal(
  await sql(`select moderation_state from private.commercial_resources where id=${q(ad)}`),
  'suspended'
)
assert.equal(
  await sql(`select advertiser_pause_count from private.commercial_resources where id=${q(ad)}`),
  '3'
)
assert.equal(
  await sql(
    `select count(*) from public.advertising_operations where resource_id=${q(ad)} and action='suspend_pause_limit'`
  ),
  '1'
)
assert.equal(
  await sql(
    `select expires_at::text from public.visibility_entitlements where resource_id=${q(ad)}`
  ),
  before
)
assert.equal(
  await sql(
    `select coalesce((select cash_balance from public.wallets where user_id=${q(user)}),0)`
  ),
  cashBefore
)
// --- Idempotência persistente por request_id (20261222000009) -----------------------------
// Segundo recurso isolado, fora do estado já consumido pelo teste de limite acima.
const placement2 = 'pause_race2_' + randomUUID().replaceAll('-', '')
const ad2 = randomUUID()
const order2 = randomUUID()
const price2 = randomUUID()
await sql(`insert into public.sponsored_ads(id,partner_name,title,created_by,display_mode,is_global)
    values(${q(ad2)},'Synthetic','Idempotency race',${q(user)},array['banner'],true);
  insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,
    approved_revision,moderation_state) values(${q(ad2)},'ad_home',${q(user)},1,1,'approved');
  update public.sponsored_ads set commercial_resource_id=${q(ad2)} where id=${q(ad2)};
  insert into private.advertising_drafts(ad_id,account_id,version,state,title,destination,
    creation_request,approved_version) values(${q(ad2)},${q(account)},1,'approved',
    'Idempotency race','https://example.invalid/idempotency-race','{}',1);
  insert into public.advertising_placements(code,name,description,surface,content_type,
    offering_code,sales_enabled,delivery_enabled,capacity) values(${q(placement2)},'Synthetic slot 2',
    'Isolated slot for the idempotency scenarios','home','banner','ad_home',true,true,1);
  insert into private.advertising_resource_inventory(resource_id,placement_code,context_id)
    values(${q(ad2)},${q(placement2)},'00000000-0000-0000-0000-000000000000');
  insert into public.commercial_price_versions(id,offering_code,revision,unit_price_cash,
    min_days,max_days,active_from,created_by,reason)
    select ${q(price2)},'ad_home',coalesce(max(revision),0)+1,7,1,30,
      clock_timestamp(),${q(user)},'Synthetic idempotency price'
    from public.commercial_price_versions where offering_code='ad_home';
  insert into public.commercial_orders(id,payer_user_id,request_id,resource_id,offering_code,
    price_version_id,content_revision,duration_days,unit_price_cash,total_cash,status,
    quote_expires_at,fulfilled_at,period_start,period_end)
    values(${q(order2)},${q(user)},gen_random_uuid(),${q(ad2)},'ad_home',${q(price2)},
      1,2,7,14,'fulfilled',now()+interval '1 hour',now()-interval '1 hour',
      now()-interval '1 hour',now()-interval '1 hour'+interval '2 days');
  insert into public.visibility_entitlements(resource_id,origin_order_id,starts_at,expires_at,
    administrative_state) values(${q(ad2)},${q(order2)},now()-interval '1 hour',
    now()-interval '1 hour'+interval '2 days','enabled')`)

const requestA = randomUUID() // first pause
const requestB = randomUUID() // first resume
const requestC = randomUUID() // second pause

// 1) Delayed retry of a pause request that arrives AFTER a resume and a second, different
// pause: the stale retry must be a pure no-op, never a third pause.
await asOwner(`select public.interrupt_advertising_campaign(${q(ad2)},'First pause',${q(requestA)})`)
await asOwner(`select public.resume_my_advertising_campaign(${q(ad2)},${q(requestB)})`)
await asOwner(`select public.interrupt_advertising_campaign(${q(ad2)},'Second pause',${q(requestC)})`)
await asOwner(`select public.interrupt_advertising_campaign(${q(ad2)},'Delayed retry of the first pause',${q(requestA)})`)
assert.equal(
  await sql(`select advertiser_pause_count from private.commercial_resources where id=${q(ad2)}`),
  '2',
  'a delayed retry of the first pause, arriving after a resume and a second pause, must not consume a third pause'
)
assert.equal(
  await sql(`select advertiser_paused_at is not null from private.commercial_resources where id=${q(ad2)}`),
  't',
  'the delayed retry must not disturb the second, unrelated pause that is actually in effect'
)

// 2) Delayed retry of the FIRST resume, arriving after the ad was paused again: must never
// lift the later, unrelated pause.
await asOwner(`select public.resume_my_advertising_campaign(${q(ad2)},${q(requestB)})`)
assert.equal(
  await sql(`select advertiser_paused_at is not null from private.commercial_resources where id=${q(ad2)}`),
  't',
  'a delayed retry of an old resume request must not lift a pause started after it'
)

// 3) Exact retry (lost response) of the operation currently in effect: same request_id,
// called again sequentially while still paused -- must stay a no-op, no new operation row.
const opsBefore = await sql(
  `select count(*) from public.advertising_operations where resource_id=${q(ad2)}`
)
await asOwner(`select public.interrupt_advertising_campaign(${q(ad2)},'Lost response retry',${q(requestC)})`)
assert.equal(
  await sql(`select count(*) from public.advertising_operations where resource_id=${q(ad2)}`),
  opsBefore,
  'retrying the exact same request after a lost response creates no additional operation'
)

// 4) Reusing a request_id for an incompatible operation (client bug) is rejected, not honored.
await asOwner(`select public.interrupt_advertising_campaign(${q(ad2)},'Reused id attempt',${q(requestB)})`).then(
  () => assert.fail('a request_id recorded for a resume must not be silently accepted as a pause'),
  (error) => assert.match(error.message, /AD_REQUEST_ID_REUSED/)
)

// 5) A real two-session race submitting the literal same request_id concurrently must still
// leave exactly one operation behind, with neither call erroring.
await asOwner(`select public.resume_my_advertising_campaign(${q(ad2)},gen_random_uuid())`)
const sharedRetry = randomUUID()
await Promise.all([
  asOwner(`select public.interrupt_advertising_campaign(${q(ad2)},'Concurrent identical retry A',${q(sharedRetry)})`),
  asOwner(`select public.interrupt_advertising_campaign(${q(ad2)},'Concurrent identical retry B',${q(sharedRetry)})`),
])
assert.equal(
  await sql(
    `select count(*) from public.advertising_operations where request_id=${q(sharedRetry)}`
  ),
  '1',
  'two concurrent submissions of the exact same request_id still produce exactly one operation'
)

// 6) Old client compatibility: the previous signatures are rejected cleanly, never silently
// run with the unsafe pre-idempotency behavior.
await asOwner(`select public.interrupt_advertising_campaign(${q(ad2)},'Old client call')`).then(
  () => assert.fail('the 2-argument signature must not silently run the unsafe old behavior'),
  (error) => assert.match(error.message, /AD_APP_UPDATE_REQUIRED/)
)
await asOwner(`select public.resume_my_advertising_campaign(${q(ad2)})`).then(
  () => assert.fail('the 1-argument signature must not silently run the unsafe old behavior'),
  (error) => assert.match(error.message, /AD_APP_UPDATE_REQUIRED/)
)

console.log(
  'Pausas concorrentes: 1 pausa efetiva, 1 suspensão por limite, prazo e EvoCash preservados. ' +
    'Idempotência por request_id: retries atrasados e respostas perdidas não geram pausas/retomadas extras, reuso indevido é rejeitado, clientes antigos recebem erro acionável.'
)

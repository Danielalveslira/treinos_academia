// Real two-session race against an isolated local PostgreSQL fixture. Never accepts a remote DB.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { verifyLocalPostgresImage } from './homolog/finance/images.mjs'

const container = process.env.PG_TEST_CONTAINER || 'hdb'
if (container !== 'hdb') throw new Error('LOCAL_DATABASE_REQUIRED')
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
  asOwner(`select public.interrupt_advertising_campaign(${q(ad)},'Concurrent first pause')`),
  asOwner(`select public.interrupt_advertising_campaign(${q(ad)},'Concurrent duplicate pause')`),
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
await asOwner(`select public.resume_my_advertising_campaign(${q(ad)})`)
await sql(`update private.commercial_resources set advertiser_pause_count=3,
  advertiser_pause_period_start=(select starts_at from public.visibility_entitlements where resource_id=${q(ad)})
  where id=${q(ad)}`)
await Promise.all([
  asOwner(`select public.interrupt_advertising_campaign(${q(ad)},'Concurrent fourth pause A')`),
  asOwner(`select public.interrupt_advertising_campaign(${q(ad)},'Concurrent fourth pause B')`),
])
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
console.log(
  'Pausas concorrentes: 1 pausa efetiva, 1 suspensão por limite, prazo e EvoCash preservados.'
)

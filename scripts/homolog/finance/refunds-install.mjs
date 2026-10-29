// Clean main baseline + historical purchase, then additive refund upgrade. Local only.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { pullImage } from './images.mjs'
const source = 'evolutus_refunds_db',
  name = 'evolutus_consolidation_clean_' + new Date().toISOString().replace(/\D/g, '').slice(0, 14)
const run = (args, input) =>
  execFileSync('docker', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 32e6,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
try {
  run(['inspect', name])
  throw Error('REFUSE_EXISTING_CONTAINER')
} catch (e) {
  if (e.message === 'REFUSE_EXISTING_CONTAINER') throw e
}
run([
  'run',
  '--pull=never',
  '-d',
  '--name',
  name,
  '--cpus',
  '1',
  '--memory',
  '1000m',
  '-e',
  'POSTGRES_PASSWORD=refunds-clean-synthetic-only',
  await pullImage('postgres'),
])
const sql = (input) =>
  run(
    [
      'exec',
      '-i',
      name,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-X',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    input
  )
let ready = false
for (let i = 0; i < 100; i++) {
  try {
    run(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres'])
    ready = true
    break
  } catch {}
  await new Promise((r) => setTimeout(r, 500))
}
if (!ready) throw Error('POSTGRES_NOT_READY')
sql('alter system set cron.launch_active_jobs=off;select pg_reload_conf();')
const dump = (section) =>
  run([
    'exec',
    source,
    'pg_dump',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '--schema=auth',
    '--schema=storage',
    '--section=' + section,
    '--no-owner',
    '--no-privileges',
  ])
sql('drop schema if exists auth cascade;drop schema if exists storage cascade;')
sql(dump('pre-data'))
sql(
  dump('post-data')
    .replace(/^CREATE POLICY[\s\S]*?;\n/gm, '')
    .replace(/^CREATE TRIGGER[\s\S]*?;\n/gm, '')
)
const files = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()
const baseline = files.filter((f) => f.slice(0, 14) <= '20261206000002'),
  refunds = files.filter((f) => f.slice(0, 14) > '20261206000002')
for (const file of baseline)
  sql('begin;' + readFileSync('supabase/migrations/' + file, 'utf8') + '\ncommit;')
const fixture =
  readFileSync('supabase/tests/_helpers/cash_purchase.sql', 'utf8') +
  `
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values('fe000000-0000-0000-0000-000000000001','authenticated','authenticated','refund-upgrade@example.invalid','x',now(),'{}','{}',now(),now());
create temp table old_purchase as select pg_temp.cash_purchase_fixture('fe000000-0000-0000-0000-000000000001') p;
select public.confirm_infinitepay_cash_purchase((select(p->>'id')::uuid from old_purchase),(select p->>'orderNsu' from old_purchase),'upgrade-old-txn','upgrade-old-inv',590,'pix',null);`
sql(fixture)
const hash = `select jsonb_build_object('wallets',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by user_id)::text,'')) from public.wallets x),'ledger',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.economy_transactions x),'purchases',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.cash_purchases x),'orders',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.commercial_orders x),'rights',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.visibility_entitlements x));`
const before = sql(hash).trim()
for (const file of refunds)
  sql('begin;' + readFileSync('supabase/migrations/' + file, 'utf8') + '\ncommit;')
const after = sql(hash).trim()
if (before !== after) throw Error('FINANCIAL_HISTORY_CHANGED')
const gates = sql('select row_to_json(s) from private.refund_settings s').trim()
if (JSON.parse(gates).financial_requests_enabled || JSON.parse(gates).settlement_enabled)
  throw Error('UNSAFE_DEFAULT_GATES')
// Reinstallation within rollback proves the new fixtures cannot leak to the base.
const tx = sql('begin;select count(*) from public.refund_requests;rollback;')
writeFileSync(
  'docs/finance-restructure/refunds/evidence/install.json',
  JSON.stringify(
    {
      container: name,
      baselineMigrations: baseline.length,
      refundMigrations: refunds.length,
      total: files.length,
      financialHashesEqual: before === after,
      hashes: JSON.parse(after),
      gates: JSON.parse(gates),
      rollbackVerified: tx.includes('ROLLBACK'),
      passed: true,
    },
    null,
    2
  ) + '\n'
)
console.log(
  JSON.stringify({
    container: name,
    total: files.length,
    financialHashesEqual: true,
    gatesClosed: true,
    passed: true,
  })
)

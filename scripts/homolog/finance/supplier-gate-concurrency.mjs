// Local disposable PostgreSQL only. Never accepts a URL, token or production target.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'

const container = 'evolutus_integrated_clean_db'
const userId = '75100000-0000-0000-0000-000000000001'
const sessionId = '75100000-0000-0000-0000-000000000002'
const runId = Date.now().toString(36)
const psql = [
  'exec',
  '-i',
  container,
  'psql',
  '-U',
  'supabase_admin',
  '-d',
  'postgres',
  '-X',
  '-qAt',
  '-v',
  'ON_ERROR_STOP=1',
]
const run = (sql) => execFileSync('docker', psql, { input: sql, encoding: 'utf8', timeout: 30000 })
const authSql = `
select set_config('request.jwt.claim.sub','${userId}',true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','${userId}','role','authenticated','session_id','${sessionId}',
  'amr',jsonb_build_array(jsonb_build_object('method','password',
    'timestamp',extract(epoch from clock_timestamp())::bigint)))::text,true);
set local role authenticated;
`

function session(sql, marker) {
  const child = spawn('docker', psql, { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  let signal
  const ready = new Promise((resolve, reject) => {
    signal = { resolve, reject }
  })
  let marked = false
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
    if (!marked && marker && output.includes(marker)) {
      marked = true
      signal.resolve()
    }
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  const done = new Promise((resolve) =>
    child.on('close', (code) => {
      if (marker && !marked)
        signal.reject(new Error(`Session ended before ${marker}: ${output.slice(-300)}`))
      resolve({ code, output })
    })
  )
  child.stdin.end(sql)
  return { ready, done }
}

function state() {
  const raw = run(`select jsonb_build_object(
    'configured',(select config#>>'{supplierInfo,configured}' from public.economy_config where id),
    'quoting',(select quoting_enabled from public.evocash_pricing_state where id),
    'sales',(select sales_enabled from public.commercial_offerings where code='post_boost'))`)
  return JSON.parse(raw.trim())
}

run(`
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('${userId}','authenticated','authenticated','supplier-race@example.invalid','x',now(),'{}','{}',now(),now()) on conflict(id) do nothing;
update public.users set role='superadmin' where id='${userId}';
insert into auth.sessions(id,user_id,created_at,updated_at)
values('${sessionId}','${userId}',now(),now()) on conflict(id) do nothing;
update public.economy_config set config=jsonb_set(config,'{supplierInfo,configured}','false') where id;
update public.evocash_pricing_state set quoting_enabled=false,checkout_enabled=false where id;
update public.commercial_offerings set sales_enabled=false where code='post_boost';
`)

// Financial UPDATE wins the table lock first. Confirmation must wait, then see
// the committed open state and fail without changing the gate or audit log.
const financialFirst = session(
  `begin;
update public.evocash_pricing_state set quoting_enabled=true where id;
select 'FINANCIAL_READY';
select pg_sleep(1.5);
commit;`,
  'FINANCIAL_READY'
)
await financialFirst.ready
const rejectedReason = `Blocked race ${runId}`
const supplierSecond = session(`begin;${authSql}
select public.admin_set_supplier_info_configured(true,'${rejectedReason}',true);
commit;`)
const stillWaiting = await Promise.race([
  supplierSecond.done.then(() => false),
  new Promise((resolve) => setTimeout(() => resolve(true), 250)),
])
assert.equal(stillWaiting, true, 'supplier RPC waited for financial update')
assert.equal((await financialFirst.done).code, 0)
const rejected = await supplierSecond.done
assert.notEqual(rejected.code, 0)
assert.match(rejected.output, /SUPPLIER_INFO_FINANCIAL_GATES_OPEN/)
assert.deepEqual(state(), { configured: 'false', quoting: true, sales: false })
assert.equal(
  Number(
    run(`select count(*) from public.admin_audit_log where reason='${rejectedReason}'`).trim()
  ),
  0
)
console.log(
  'ok - financial update commits first; supplier RPC waits, rejects, and writes no audit event'
)

run('update public.evocash_pricing_state set quoting_enabled=false where id;')
// The supplier RPC wins first. A simultaneous commercial UPDATE must wait for
// its transaction to commit; the confirmation sees only closed controls.
const approvedReason = `Approved race ${runId}`
const supplierFirst = session(
  `begin;${authSql}
select public.admin_set_supplier_info_configured(true,'${approvedReason}',true);
select 'SUPPLIER_READY';
select pg_sleep(1.5);
commit;`,
  'SUPPLIER_READY'
)
await supplierFirst.ready
const financialSecond = session(`begin;
update public.commercial_offerings set sales_enabled=true where code='post_boost';
select 'SALES_UPDATED';
commit;`)
const saleWaiting = await Promise.race([
  financialSecond.done.then(() => false),
  new Promise((resolve) => setTimeout(() => resolve(true), 250)),
])
assert.equal(saleWaiting, true, 'commercial update waited for supplier RPC')
assert.equal((await supplierFirst.done).code, 0)
assert.equal((await financialSecond.done).code, 0)
assert.deepEqual(state(), { configured: 'true', quoting: false, sales: true })
assert.equal(
  Number(
    run(`select count(*) from public.admin_audit_log where reason='${approvedReason}'`).trim()
  ),
  1
)
console.log(
  'ok - supplier RPC commits first; commercial update waits and remains a separate later action'
)

run(`
update public.economy_config set config=jsonb_set(config,'{supplierInfo,configured}','false') where id;
update public.commercial_offerings set sales_enabled=false where code='post_boost';
`)
// A pending checkout reservation inserted before confirmation must also win.
// This protects the resume path even when new quoting is paused.
const pendingFirst = session(
  `begin;
insert into public.cash_purchases(user_id,request_id,package_id,package_label,cash_amount,amount_centavos,status,payment_provider,provider_order_nsu)
values('${userId}','supplier-race-${runId}','synthetic','Synthetic fixture',1,100,'pending','infinitepay','supplier-race-${runId}');
select 'PENDING_READY';
select pg_sleep(1.5);
commit;`,
  'PENDING_READY'
)
await pendingFirst.ready
const pendingReason = `Pending race ${runId}`
const supplierAfterPending = session(`begin;${authSql}
select public.admin_set_supplier_info_configured(true,'${pendingReason}',true);
commit;`)
const pendingWait = await Promise.race([
  supplierAfterPending.done.then(() => false),
  new Promise((resolve) => setTimeout(() => resolve(true), 250)),
])
assert.equal(pendingWait, true, 'supplier RPC waited for pending purchase insert')
assert.equal((await pendingFirst.done).code, 0)
const pendingRejected = await supplierAfterPending.done
assert.notEqual(pendingRejected.code, 0)
assert.match(pendingRejected.output, /SUPPLIER_INFO_FINANCIAL_GATES_OPEN/)
assert.equal(state().configured, 'false')
assert.equal(
  Number(run(`select count(*) from public.admin_audit_log where reason='${pendingReason}'`).trim()),
  0
)
console.log('ok - pending purchase commits first; supplier RPC waits and rejects without audit')

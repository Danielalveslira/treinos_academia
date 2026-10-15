// PostgreSQL LOCAL only. No URLs or production credentials accepted.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
const run = promisify(execFile)
const container = 'evolutus_aud_postgres'
const admin = randomUUID(),
  target = randomUUID(),
  second = randomUUID()
const suffix = target.replaceAll('-', '')
const trigger = `admin_contas_delay_${suffix}`
const sql = async (query) =>
  (
    await run('docker', [
      'exec',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      query,
    ])
  ).stdout.trim()
const actor = `select set_config('request.jwt.claim.sub','${admin}',false);`
const status = (id = target) =>
  `${actor} select count(*) from public.set_account_status('${id}',true,'Motivo concorrente sintético');`
await sql(
  `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) select id::uuid,'authenticated','authenticated','fixture-'||id||'@example.invalid','unused',now(),'{}','{}',now(),now() from unnest(array['${admin}','${target}','${second}']) id; update public.users set role='superadmin' where id='${admin}';`
)
const evidence = { environment: 'local PostgreSQL', tests: [] }
try {
  await sql(
    `create function public.${trigger}() returns trigger language plpgsql as $$ begin if new.id='${target}' then perform pg_sleep(1); end if; return new; end; $$; create trigger ${trigger} before update on public.users for each row execute function public.${trigger}();`
  )
  await Promise.all([sql(status()), sql(status())])
  const logs = Number(
    await sql(
      `select count(*) from public.admin_audit_log where target_user_id='${target}' and action='account_disabled'`
    )
  )
  assert.equal(logs, 1)
  evidence.tests.push({ name: 'simultaneous disable replay', auditRows: logs, passed: true })
  await Promise.all([
    sql(
      `${actor} select public.admin_request_account_deletion('${target}','Pedido concorrente sintético');`
    ),
    sql(
      `${actor} select public.admin_request_account_deletion('${target}','Pedido concorrente sintético');`
    ),
  ])
  const deletionLogs = Number(
    await sql(
      `select count(*) from public.admin_audit_log where target_user_id='${target}' and action='account_deletion_requested'`
    )
  )
  assert.equal(deletionLogs, 1)
  assert.equal(
    await sql(`select account_status from public.users where id='${target}'`),
    'deleting'
  )
  evidence.tests.push({ name: 'concurrent deletion replay', auditRows: deletionLogs, passed: true })
  // Start a deletion transaction, hold the user lock, then attempt status change.
  const deletion = sql(
    `${actor} begin; select public.admin_request_account_deletion('${second}','Pedido antes do status'); select pg_sleep(2); commit;`
  )
  await new Promise((resolve) => setTimeout(resolve, 200))
  await assert.rejects(sql(status(second)), (error) => error.stderr.includes('ACCOUNT_DELETING'))
  await deletion
  assert.equal(
    await sql(`select account_status from public.users where id='${second}'`),
    'deleting'
  )
  evidence.tests.push({ name: 'status waits for deletion and rejects', passed: true })
} finally {
  await sql(
    `drop trigger if exists ${trigger} on public.users; drop function if exists public.${trigger}();`
  )
}
await mkdir('docs/releases/admin-contas', { recursive: true })
await writeFile('docs/releases/admin-contas/concurrency.json', JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence))

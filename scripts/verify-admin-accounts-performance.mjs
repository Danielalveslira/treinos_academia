// Actual snapshot payload/query timing on PostgreSQL LOCAL. Synthetic rows, rollback each run.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
const run = promisify(execFile),
  admin = randomUUID(),
  results = []
for (const volume of [7, 100, 1000, 1200]) {
  const query = `begin;
 insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ('${admin}','authenticated','authenticated','snapshot-admin@example.invalid','unused',now(),'{}','{}',now(),now());
 update public.users set role='superadmin' where id='${admin}';
 insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select gen_random_uuid(),'authenticated','authenticated','volume'||n||'@example.invalid','unused',now(),'{}','{}',now(),now() from generate_series(1,${volume}) n;
 select set_config('request.jwt.claim.sub','${admin}',true);
 select jsonb_build_object('volume',${volume},'total',s->'meta'->'total','returned',s->'meta'->'returned','truncated',s->'meta'->'truncated','payload_bytes',octet_length(s::text)) from (select public.admin_accounts_snapshot() s) q;
 explain (analyze,buffers,format json) select public.admin_accounts_snapshot();
 rollback;`
  const { stdout } = await run('docker', [
    'exec',
    'evolutus_aud_postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-X',
    '-qAt',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    query,
  ])
  const row = JSON.parse(stdout.split('\n').find((line) => line.startsWith('{')))
  const plan = JSON.parse(stdout.slice(stdout.indexOf('[\n')))
  results.push({
    ...row,
    execution_ms: plan[0]['Execution Time'],
    planning_ms: plan[0]['Planning Time'],
    shared_hit_blocks: plan[0].Plan['Shared Hit Blocks'],
  })
}
await writeFile(
  'docs/releases/admin-contas/sql-performance.json',
  JSON.stringify(
    {
      environment:
        'local PostgreSQL; synthetic fixtures plus existing local fixture rows; every measurement rolled back',
      results,
    },
    null,
    2
  )
)
console.log(JSON.stringify(results))

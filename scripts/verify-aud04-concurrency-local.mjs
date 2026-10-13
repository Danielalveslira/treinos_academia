// PostgreSQL concurrency test. Local synthetic DB only; no Storage or remote endpoints.
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const args = [
  'exec',
  '-i',
  'evolutus_aud_postgres',
  'psql',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-X',
  '-At',
  '-v',
  'ON_ERROR_STOP=1',
]
const sql = (input) =>
  execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
assert.equal(
  sql("select current_setting('cron.launch_active_jobs', true);"),
  'off',
  'local pg_cron launcher must be disabled'
)
assert.equal(
  sql('select count(*) from public.storage_cleanup_tasks;'),
  '0',
  'requires empty synthetic queue'
)
const folder = randomUUID(),
  ids = Array.from({ length: 25 }, () => randomUUID())
sql(
  `insert into public.storage_cleanup_tasks(id,bucket,reference,object_key,source_id) values ${ids.map((id) => `('${id}','status-photos','${folder}/${id}.webp','${folder}/${id}.webp','${id}')`).join(',')};`
)
const holder = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
let output = '',
  errors = ''
holder.stdout.on('data', (chunk) => {
  output += chunk
})
holder.stderr.on('data', (chunk) => {
  errors += chunk
})
const ready = new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(Error('transaction readiness timeout')), 10000)
  holder.stdout.on('data', () => {
    if (output.includes('HELD')) {
      clearTimeout(deadline)
      resolve()
    }
  })
  holder.on('error', reject)
  holder.on('exit', (code) => {
    if (code) reject(Error(`holder failed: ${errors}`))
  })
})
const finished = new Promise((resolve, reject) =>
  holder.on('exit', (code) => (code === 0 ? resolve() : reject(Error(errors))))
)
holder.stdin.write(
  "begin;select count(*) from public.claim_storage_cleanup_tasks();select 'HELD';\n"
)
try {
  await ready
  // First transaction still holds locks; second must skip 20 rows and claim 5 immediately.
  assert.equal(
    sql("set statement_timeout='2s';select count(*) from public.claim_storage_cleanup_tasks();")
      .split('\n')
      .at(-1),
    '5'
  )
  holder.stdin.end('commit;\n')
  await finished
  assert.ok(output.startsWith('BEGIN\n20\nHELD'))
  assert.equal(
    sql("select count(*) from public.storage_cleanup_tasks where state='leased' and attempts=1;"),
    '25'
  )
  sql("update public.storage_cleanup_tasks set lease_until=now()-interval '1 second';")
  assert.equal(sql('select count(*) from public.claim_storage_cleanup_tasks();'), '20')
  assert.equal(sql('select count(*) from public.claim_storage_cleanup_tasks();'), '5')
  assert.equal(
    sql("select count(*) from public.storage_cleanup_tasks where state='leased' and attempts=2;"),
    '25'
  )
  // No Storage objects exist for this test; leave the synthetic task inventory for inspection.
  console.log(
    'PASS: overlapping transactions SKIP LOCKED 20 + 5; crash recovery 20 + 5; no task lost'
  )
} finally {
  if (holder.exitCode === null) holder.kill()
}

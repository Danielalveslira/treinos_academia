// Local only: synthetic Auth/PostgREST/Storage; never accepts a remote URL or reads .env.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { jwt } from './homolog/keys.mjs'
import { startAudGateway } from './homolog/aud-local-gateway.mjs'
import { processDeletionJobs } from '../supabase/functions/process-deletion-jobs/processor.js'
import { processStorageCleanup } from '../supabase/functions/process-deletion-jobs/storage-cleanup.js'
const dbArgs = [
  'exec',
  '-i',
  'evolutus_homolog_db',
  'psql',
  '-U',
  'supabase_admin',
  '-d',
  'postgres',
  '-X',
  '-At',
  '-v',
  'ON_ERROR_STOP=1',
]
const sql = (s) =>
  execFileSync('docker', dbArgs, {
    input: s,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
assert.equal(sql("select current_setting('cron.launch_active_jobs')"), 'off')
assert.equal(
  sql("select count(*) from public.storage_cleanup_tasks where state in ('pending','leased')"),
  '0',
  'refuse unrelated local cleanup backlog'
)
const gateway = await startAudGateway(),
  url = 'http://127.0.0.1:55439',
  opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, jwt({ role: 'service_role' }), opts)
const [author, reviewer, outsider, community] = Array.from({ length: 4 }, () => randomUUID()),
  posts = []
const user = (id) =>
  createClient(url, jwt({ role: 'authenticated', aud: 'authenticated', sub: id }), opts)
const sa = user(reviewer),
  asAuthor = user(author),
  asOutsider = user(outsider)
const good = (r) => {
  assert.equal(r.error, null)
  return r.data
}
const checks = []
const check = (name, value = true) => {
  assert.ok(value, name)
  checks.push(name)
  console.log('PASS ' + name)
}
// Synthetic 1x1 WebP, shared with the AUD-04 regression; no external fixture required.
const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
const log = { log() {}, error() {} }
async function photo() {
  const id = randomUUID()
  posts.push(id)
  good(
    await asAuthor.from('statuses').insert({
      id,
      author_id: author,
      community_id: community,
      type: 'photo',
      photo_path: `statusPhotos/${community}/${id}.webp`,
    })
  )
  good(
    await asAuthor.storage
      .from('status-photos')
      .upload(`${community}/${id}.webp`, bytes, { contentType: 'image/webp' })
  )
  return id
}
async function queue(id) {
  good(await sa.rpc('queue_deletion', { p_kind: 'status', p_target_id: id }))
  return good(await admin.from('deletion_jobs').select('id').eq('target_id', id).single()).id
}
function hold(input) {
  const child = spawn('docker', dbArgs)
  let output = '',
    error = '',
    resolveHeld
  const held = new Promise((r) => (resolveHeld = r))
  child.stdout.on('data', (b) => {
    output += b
    if (output.includes('AUD05_HELD')) resolveHeld()
  })
  child.stderr.on('data', (b) => (error += b))
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(error))))
  })
  child.stdin.end(input)
  return { held, done }
}
try {
  for (const id of [author, reviewer, outsider])
    good(
      await admin.auth.admin.createUser({
        id,
        email: `aud05-${id}@example.invalid`,
        password: 'Synthetic-AUD05-913!',
        email_confirm: true,
      })
    )
  sql(
    `update public.users set role='superadmin' where id='${reviewer}';update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now() from public.legal_policy p where p.id and p.published and u.id in('${author}','${reviewer}','${outsider}');insert into public.communities(id,name,created_by,owner_id) values('${community}','AUD05 integration','${author}','${author}');insert into public.community_members(community_id,user_id) values('${community}','${author}');`
  )
  const id = await photo()
  check('real authenticated photo upload accepted')
  check(
    'outsider cannot enqueue admin deletion',
    !!(await asOutsider.rpc('queue_deletion', { p_kind: 'status', p_target_id: id })).error
  )
  check(
    'authenticated caller cannot execute worker RPC',
    !!(await sa.rpc('run_deletion_job', { p_job_id: randomUUID() })).error
  )
  good(await asOutsider.from('statuses').delete().eq('id', id))
  check(
    'RLS leaves foreign publication intact',
    sql(`select count(*) from public.statuses where id='${id}'`) === '1'
  )
  const job = await queue(id)
  await Promise.all([
    sa.rpc('queue_deletion', { p_kind: 'status', p_target_id: id }),
    sa.rpc('queue_deletion', { p_kind: 'status', p_target_id: id }),
  ]).then((results) => results.forEach(good))
  check(
    'repeated concurrent requests keep one queued job',
    sql(`select count(*) from public.deletion_jobs where target_id='${id}'`) === '1'
  )
  const scoped = {
    rpc: async (name, args) =>
      name === 'list_pending_deletion_jobs'
        ? { data: [{ id: job }], error: null }
        : admin.rpc(name, args),
    storage: admin.storage,
    auth: admin.auth,
  }
  const failing = {
    ...scoped,
    storage: { from: () => ({ remove: async () => ({ error: { status: 503 } }) }) },
  }
  const first = await processDeletionJobs(failing, log)
  check(
    'admin worker deletes photo record end to end',
    first.processed === 1 && sql(`select count(*) from public.statuses where id='${id}'`) === '0'
  )
  check(
    'Storage outage remains pending in AUD04',
    first.cleanupErrored === 1 &&
      sql(`select state from public.storage_cleanup_tasks where source_id='${id}'`) === 'pending'
  )
  check(
    'file remains downloadable until retry',
    !(await admin.storage.from('status-photos').download(`${community}/${id}.webp`)).error
  )
  sql(`update public.storage_cleanup_tasks set next_attempt_at=now() where source_id='${id}';`)
  const retries = await Promise.all([
    processStorageCleanup(admin, log),
    processStorageCleanup(admin, log),
  ])
  check(
    'two concurrent workers remove file and acknowledge once',
    retries.reduce((n, r) => n + r.cleanupCompleted, 0) === 1
  )
  check(
    'file physically absent after retry',
    !!(await admin.storage.from('status-photos').download(`${community}/${id}.webp`)).error
  )
  check(
    'AUD04 task complete after physical cleanup',
    sql(`select state from public.storage_cleanup_tasks where source_id='${id}'`) === 'complete'
  )
  check(
    'completed deletion repeated safely',
    good(await admin.rpc('run_deletion_job', { p_job_id: job })).skipped === true
  )
  const race = await photo(),
    raceJob = await queue(race)
  const h = hold(
    `begin;select public.run_deletion_job('${raceJob}');\n\\echo AUD05_HELD\nselect pg_sleep(0.7);commit;`
  )
  await h.held
  const second = await admin.rpc('run_deletion_job', { p_job_id: raceJob })
  await h.done
  check('overlapping deletion waits and skips completed job', good(second).skipped === true)
  check(
    'overlapping deletion captures one photo cleanup',
    sql(`select count(*) from public.storage_cleanup_tasks where source_id='${race}'`) === '1'
  )
  const direct = await photo(),
    directJob = await queue(direct)
  const authorHold = hold(
    `begin;set local role authenticated;select set_config('request.jwt.claim.sub','${author}',true);delete from public.statuses where id='${direct}';\n\\echo AUD05_HELD\nselect pg_sleep(0.7);commit;`
  )
  await authorHold.held
  const afterAuthor = await admin.rpc('run_deletion_job', { p_job_id: directJob })
  await authorHold.done
  check('author deletion races queued admin safely', good(afterAuthor).complete === true)
  check(
    'author/admin race still has one durable task',
    sql(`select count(*) from public.storage_cleanup_tasks where source_id='${direct}'`) === '1'
  )
  const drained = await processStorageCleanup(admin, log)
  check(
    'remaining synthetic race files cleaned by existing AUD04 worker',
    drained.cleanupCompleted === 2
  )
  for (const id of [race, direct])
    check(
      'race file physically absent ' + id,
      !!(await admin.storage.from('status-photos').download(`${community}/${id}.webp`)).error
    )
  await writeFile(
    '/tmp/aud05/integration.json',
    JSON.stringify({ localOnly: true, checks, passed: checks.length }, null, 2)
  )
} finally {
  // Cleanup only these synthetic identities; append-only administrative/financial audit remains.
  for (const id of posts) {
    const r = await admin.storage.from('status-photos').remove([`${community}/${id}.webp`])
    assert.equal(r.error, null)
  }
  sql(
    `delete from public.statuses where community_id='${community}';delete from public.storage_cleanup_tasks where source_id in (${posts.length ? posts.map((id) => `'${id}'`).join(',') : "'00000000-0000-0000-0000-000000000000'"});delete from public.communities where id='${community}';delete from public.deletion_jobs where target_id in ('${community}',${[...posts, author, reviewer, outsider].map((id) => `'${id}'`).join(',')});`
  )
  for (const id of [author, reviewer, outsider]) good(await admin.auth.admin.deleteUser(id))
  await new Promise((resolve) => gateway.close(resolve))
}

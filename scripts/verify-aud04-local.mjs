// Local only; creates fresh synthetic fixtures. Never reads .env or accepts remote URLs.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { jwt } from './homolog/keys.mjs'
import { startAudGateway } from './homolog/aud-local-gateway.mjs'
import { processDeletionJobs } from '../supabase/functions/process-deletion-jobs/processor.js'
import { processStorageCleanup } from '../supabase/functions/process-deletion-jobs/storage-cleanup.js'
const API = 'http://127.0.0.1:55439'
const admin = createClient(API, jwt({ role: 'service_role' }), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const silent = { log() {}, error() {} }
let checks = 0
function check(value, label) {
  assert.ok(value, label)
  checks++
  console.log(`PASS ${label}`)
}
function good(r) {
  assert.equal(r.error, null)
  return r.data
}
function sql(input) {
  return execFileSync(
    'docker',
    [
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
    ],
    { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}
const gateway = await startAudGateway()
try {
  // Migrations contain remote cron URLs; the local launcher must remain disabled.
  assert.equal(
    sql("select current_setting('cron.launch_active_jobs', true);"),
    'off',
    'local pg_cron launcher must be disabled'
  )
  // Do not run the worker on pre-existing fixtures; refuse an existing cleanup queue.
  check(
    sql("select count(*) from public.storage_cleanup_tasks where state <> 'complete';") === '0',
    'no unrelated unfinished local cleanup tasks'
  )
  const ids = Array.from({ length: 3 }, () => randomUUID())
  const [author, owner, reviewer] = ids
  const password = 'Synthetic-AUD04-913!'
  for (const id of ids)
    good(
      await admin.auth.admin.createUser({
        id,
        email: `aud04-${id}@example.invalid`,
        password,
        email_confirm: true,
      })
    )
  sql(`update public.users set role='superadmin' where id='${reviewer}';
 update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now() from public.legal_policy p where p.id and p.published and u.id in('${author}','${owner}','${reviewer}');`)
  const community = randomUUID(),
    aPhoto = randomUUID(),
    cPhoto = randomUUID(),
    directPhoto = randomUUID(),
    avatar = randomUUID()
  sql(`insert into public.communities(id,name,created_by,owner_id) values('${community}','AUD04 synthetic','${owner}','${owner}');
 insert into public.community_members(community_id,user_id) values('${community}','${author}');
 insert into public.profile_avatar_media(id,owner_id,storage_path) values('${avatar}','${author}','${author}/${avatar}.webp');`)
  // RLS upload for the author follows the production statuses -> upload ordering.
  const user = createClient(API, jwt({ role: 'anon' }), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  good(await user.auth.signInWithPassword({ email: `aud04-${author}@example.invalid`, password }))
  for (const id of [aPhoto, cPhoto, directPhoto]) {
    good(
      await user.from('statuses').insert({
        id,
        community_id: community,
        author_id: author,
        type: 'photo',
        photo_path: `statusPhotos/${community}/${id}.webp`,
      })
    )
  }
  // cPhoto belongs to owner so that it survives account deletion.
  const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
  for (const id of [aPhoto, cPhoto, directPhoto])
    good(
      await user.storage
        .from('status-photos')
        .upload(`${community}/${id}.webp`, bytes, { contentType: 'image/webp' })
    )
  good(
    await user.storage
      .from('profile-avatars')
      .upload(`${author}/${avatar}.webp`, bytes, { contentType: 'image/webp' })
  )
  sql(`update public.statuses set author_id='${owner}' where id='${cPhoto}';`)
  check(true, 'authenticated upload to both real local buckets')
  // Unauthorized user cannot delete another author's photo, enqueue or edit cleanup.
  check(!!(await user.rpc('claim_storage_cleanup_tasks')).error, 'user cannot claim cleanup')
  check(
    !!(
      await user
        .from('storage_cleanup_tasks')
        .insert({ bucket: 'status-photos', reference: 'foreign', source_id: randomUUID() })
    ).error,
    'user cannot enqueue foreign cleanup'
  )
  check(
    !!(
      await user.from('storage_cleanup_tasks').update({ state: 'complete' }).eq('source_id', aPhoto)
    ).error,
    'user cannot edit cleanup'
  )
  check(
    !!(
      await user.rpc('finish_storage_cleanup_task', {
        p_id: randomUUID(),
        p_token: randomUUID(),
        p_error: null,
      })
    ).error,
    'user cannot finish cleanup'
  )
  // Direct post deletion queues from OLD even when run_deletion_job no longer sees the row.
  good(await user.from('statuses').delete().eq('id', directPhoto))
  check(
    sql(
      `select count(*) from public.storage_cleanup_tasks where source_id='${directPhoto}' and state='pending';`
    ) === '1',
    'direct deletion captured durably'
  )
  sql(
    `select set_config('request.jwt.claim.sub','${reviewer}',false); select public.queue_deletion('account','${author}');`
  )
  // Scope worker's job list to these fixtures; all other RPCs/Storage/Auth are real.
  const scoped = {
    rpc: async (name, args) => {
      if (name === 'list_pending_deletion_jobs') {
        return admin
          .from('deletion_jobs')
          .select('id,kind,target_id')
          .in('target_id', [author, community, directPhoto])
          .in('state', ['pending', 'auth_cleanup'])
      }
      return admin.rpc(name, args)
    },
    storage: admin.storage,
    auth: admin.auth,
  }
  let failures = 0
  const failing = {
    ...scoped,
    storage: {
      from: () => ({
        remove: async () => {
          failures++
          return { error: { status: 503 } }
        },
      }),
    },
  }
  const first = await processDeletionJobs(failing, silent)
  check(
    first.cleanupErrored === 3 && first.cleanupCompleted === 0 && failures === 3,
    'SDK Storage failure remains durable for three photos'
  )
  check(
    sql(`select count(*) from public.statuses where id in('${aPhoto}','${directPhoto}');`) === '0',
    'account photo rows gone before Storage retry'
  )
  check(
    sql(`select count(*) from public.profile_avatar_media where owner_id='${author}';`) === '0',
    'avatar reference gone before Storage retry'
  )
  check(
    sql(
      "select count(*) from public.storage_cleanup_tasks where state='pending' and attempts=1;"
    ) === '3',
    'all failures pending despite account Auth completion'
  )
  check(!!(await admin.auth.admin.getUserById(author)).error, 'real local Auth account removed')
  check(
    !!good(await admin.storage.from('status-photos').download(`${community}/${aPhoto}.webp`)),
    'failed removal leaves bytes present'
  )
  sql(
    "update public.storage_cleanup_tasks set next_attempt_at=now()-interval '1 second' where state='pending';"
  )
  // Fresh client = restart; two concurrent worker executions must not lose tasks.
  const restarted = createClient(API, jwt({ role: 'service_role' }), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const concurrent = await Promise.all([
    processStorageCleanup(admin, silent),
    processStorageCleanup(restarted, silent),
  ])
  check(
    concurrent.reduce((n, r) => n + r.cleanupCompleted, 0) === 3,
    'restart and concurrent workers complete each task once'
  )
  check(
    sql(
      `select count(*) from public.storage_cleanup_tasks where state='complete' and attempts=2 and source_id in ('${aPhoto}','${directPhoto}','${avatar}');`
    ) === '3',
    'second attempts persisted'
  )
  check(
    !!(await admin.storage.from('status-photos').download(`${community}/${aPhoto}.webp`)).error,
    'status object physically absent'
  )
  check(
    !!(await admin.storage.from('profile-avatars').download(`${author}/${avatar}.webp`)).error,
    'avatar physically absent in correct bucket'
  )
  check(
    !!good(await admin.storage.from('status-photos').download(`${community}/${cPhoto}.webp`)),
    'unrelated community photo preserved'
  )
  sql(
    `select set_config('request.jwt.claim.sub','${reviewer}',false); select public.queue_deletion('community','${community}');`
  )
  const communityResult = await processDeletionJobs(scoped, silent)
  check(communityResult.cleanupCompleted === 1, 'community SQL deletion and physical cleanup')
  check(
    !!(await admin.storage.from('status-photos').download(`${community}/${cPhoto}.webp`)).error,
    'community photo physically absent'
  )
  check(
    (await processDeletionJobs(scoped, silent)).cleanupQueued === 0,
    'repeat execution idempotent'
  )
  // Actual Storage API missing objects returns success (empty result); exercise it directly.
  good(await admin.storage.from('status-photos').remove([`${community}/${aPhoto}.webp`]))
  check(true, 'real Storage repeated removal succeeds for absent object')
  // AUD-05 regression: status branch now removes an existing photo and captures AUD-04 cleanup.
  const blocked = randomUUID(),
    blockedCommunity = randomUUID()
  sql(`insert into public.communities(id,name,created_by,owner_id) values('${blockedCommunity}','AUD05 dependency','${owner}','${owner}');
 insert into public.statuses(id,community_id,author_id,type,photo_path) values('${blocked}','${blockedCommunity}','${owner}','photo','statusPhotos/${blockedCommunity}/${blocked}.webp');
 select set_config('request.jwt.claim.sub','${reviewer}',false);select public.queue_deletion('status','${blocked}');`)
  const job = good(await admin.from('deletion_jobs').select('id').eq('target_id', blocked).single())
  const dependency = good(await admin.rpc('run_deletion_job', { p_job_id: job.id }))
  check(dependency.complete === true, 'AUD-05 administrative photo deletion completes')
  check(
    sql(`select count(*) from public.storage_cleanup_tasks where source_id='${blocked}';`) === '1',
    'AUD-05 captures its photo in existing AUD-04 outbox'
  )
  await processStorageCleanup(admin, silent)
  // SQL concurrency with transaction overlap exercises SKIP LOCKED (one fixture, never Storage).
  const leaseId = randomUUID()
  sql(
    `insert into public.storage_cleanup_tasks(id,bucket,reference,object_key,source_id) values('${leaseId}','status-photos','${owner}/${leaseId}.webp','${owner}/${leaseId}.webp','${leaseId}');`
  )
  const lease = good(await admin.rpc('claim_storage_cleanup_tasks'))
  check(lease.length === 1, 'crash scenario task leased')
  check(
    good(await restarted.rpc('claim_storage_cleanup_tasks')).length === 0,
    'active lease unavailable to concurrent client'
  )
  sql(
    `update public.storage_cleanup_tasks set lease_until=now()-interval '1 second' where id='${leaseId}';`
  )
  const reclaim = good(await restarted.rpc('claim_storage_cleanup_tasks'))
  check(
    reclaim.length === 1 && reclaim[0].lease_token !== lease[0].lease_token,
    'crash lease reclaimed with new token'
  )
  check(
    good(
      await admin.rpc('finish_storage_cleanup_task', {
        p_id: leaseId,
        p_token: lease[0].lease_token,
        p_error: null,
      })
    ) === false,
    'stale worker cannot acknowledge reclaimed task'
  )
  const absent = await processStorageCleanup(admin, silent) // reclaimed lease still active, nothing claimed
  check(absent.cleanupQueued === 0, 'leased task not double processed')
  good(
    await restarted.rpc('finish_storage_cleanup_task', {
      p_id: leaseId,
      p_token: reclaim[0].lease_token,
      p_error: null,
    })
  )
  console.log(`AUD04 local integration: ${checks} checks passed; fixtures retained for inspection.`)
} finally {
  await new Promise((resolve) => gateway.close(resolve))
}

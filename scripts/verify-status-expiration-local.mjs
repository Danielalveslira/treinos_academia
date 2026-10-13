// Local only: fixed gateway/container, synthetic IDs, no .env or remote URL accepted.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { jwt } from './homolog/keys.mjs'
import { startAudGateway } from './homolog/aud-local-gateway.mjs'
import { processStorageCleanup } from '../supabase/functions/process-deletion-jobs/storage-cleanup.js'
const args = [
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
const sql = (input) =>
  execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const parse = (query) => JSON.parse(sql(query))
const good = (result) => {
  assert.equal(result.error, null)
  return result.data
}
let checks = 0
const check = (value, label) => {
  assert.ok(value, label)
  checks++
  console.log(`PASS ${label}`)
}
const url = 'http://127.0.0.1:55439'
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, jwt({ role: 'service_role' }), options)
const [owner, reader, community, photo, paidPhoto, lockedStatus] = Array.from({ length: 6 }, () =>
  randomUUID()
)
const user = createClient(url, jwt({ role: 'authenticated', sub: reader }), options)
const gateway = await startAudGateway()
let originalQueue = []
let originalTasks = []
try {
  assert.equal(sql("select current_setting('cron.launch_active_jobs');"), 'off')
  assert.equal(sql('select enabled from public.status_expiration_control where id;'), 'f')
  originalQueue = parse(
    "select coalesce(jsonb_agg(to_jsonb(q)),'[]') from public.status_expiration_queue q;"
  )
  originalTasks = parse(
    "select coalesce(jsonb_agg(jsonb_build_object('id',id,'next_attempt_at',next_attempt_at)),'[]') from public.storage_cleanup_tasks where state='pending';"
  )
  for (const id of [owner, reader])
    good(
      await admin.auth.admin.createUser({
        id,
        email: `expiry-${id}@example.invalid`,
        password: 'Synthetic-Expiry-913!',
        email_confirm: true,
      })
    )
  sql(`update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now() from public.legal_policy p where p.id and p.published and u.id in ('${owner}','${reader}');
    insert into public.communities(id,name,created_by,owner_id) values('${community}','Expiry synthetic','${owner}','${owner}');
    insert into public.community_members(community_id,user_id) values('${community}','${reader}');
    insert into public.statuses(id,community_id,author_id,type,expires_at,photo_path) values
      ('${photo}','${community}','${owner}','photo',now()-interval '1 day','statusPhotos/${community}/${photo}.webp'),
      ('${paidPhoto}','${community}','${owner}','photo',now()-interval '1 day','statusPhotos/${community}/${paidPhoto}.webp');
    insert into public.statuses(id,community_id,author_id,type,expires_at,text) values('${lockedStatus}','${community}','${owner}','text',now()-interval '1 day','Locked synthetic');
    insert into public.promotions(owner_id,request_id,target_type,target_id,community_id,package_id,cash_amount,duration_days,started_at,expires_at)
      values('${owner}','expiry:${paidPhoto}','post','${paidPhoto}','${community}','post_boost_3d',25,3,now()-interval '1 day',now()+interval '2 days');
    update public.statuses s set promoted=true,promoted_until=p.expires_at,active_promotion_id=p.id from public.promotions p where s.id='${paidPhoto}' and p.target_id=s.id;
    update public.status_expiration_queue set next_attempt_at=now()+interval '1 year' where status_id not in('${photo}','${paidPhoto}','${lockedStatus}');
    update public.storage_cleanup_tasks set next_attempt_at=now()+interval '1 year' where state='pending';`)
  const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
  for (const id of [photo, paidPhoto])
    good(
      await admin.storage
        .from('status-photos')
        .upload(`${community}/${id}.webp`, bytes, { contentType: 'image/webp' })
    )
  const feed = good(
    await user
      .from('status_publications')
      .select('id,verified_promoted_until,publication_expires_at')
      .eq('community_id', community)
      .or(`publication_expires_at.is.null,publication_expires_at.gt.${new Date().toISOString()}`)
  )
  check(
    feed.length === 1 && feed[0].id === paidPhoto,
    'expired paid photo appears in feed, expired normal photo does not'
  )
  const previews = good(
    await user
      .from('communities')
      .select('id,statuses:status_publications(id)')
      .eq('id', community)
      .or(`publication_expires_at.is.null,publication_expires_at.gt.${new Date().toISOString()}`, {
        referencedTable: 'statuses',
      })
      .limit(1, { referencedTable: 'statuses' })
  )
  check(
    previews[0]?.statuses[0]?.id === paidPhoto,
    'PostgREST discovers view FK for community preview'
  )
  good(
    await user.storage.from('status-photos').createSignedUrl(`${community}/${paidPhoto}.webp`, 60)
  )
  check(true, 'member can sign expired photo with valid promotion through Storage RLS')
  check(
    !!(await user.storage.from('status-photos').createSignedUrl(`${community}/${photo}.webp`, 60))
      .error,
    'member cannot sign expired unpromoted photo'
  )
  check(
    !!(await user.rpc('process_expired_statuses')).error,
    'client cannot invoke destructive RPC'
  )
  const shared = randomUUID()
  sql(`insert into public.statuses(id,community_id,author_id,type,expires_at,poll_question,poll_options,photo_path)
    values('${shared}','${community}','${owner}','poll',now()+interval '1 day','Shared photo','[{"id":"0","label":"a"},{"id":"1","label":"b"}]','statusPhotos/${community}/${photo}.webp');`)
  // Deterministic concurrency: a real second PostgreSQL session holds the status lock.
  const holder = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let ready = ''
  const held = new Promise((resolve, reject) => {
    holder.stdout.on('data', (chunk) => {
      ready += chunk
      if (ready.includes('HELD')) resolve()
    })
    holder.once('error', reject)
  })
  holder.stdin.write(
    `begin; select id from public.statuses where id='${lockedStatus}' for update; select 'HELD';\n`
  )
  await held
  sql('update public.status_expiration_control set enabled=true;')
  let result = parse('select public.process_expired_statuses(50);')
  check(
    result.deleted === 1 && result.errors === 0,
    'batch skips status locked by concurrent session'
  )
  check(
    sql(`select count(*) from public.statuses where id='${lockedStatus}';`) === '1',
    'concurrent locked status preserved'
  )
  holder.stdin.end('commit;\n')
  await once(holder, 'exit')
  result = parse('select public.process_expired_statuses(50);')
  check(result.deleted === 1, 'next batch deletes unlocked eligible status')
  check(parse('select public.process_expired_statuses(50);').deleted === 0, 'repeat run idempotent')
  // Real SQL advisory lock prevents overlapping batches.
  const mutex = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let mutexOut = ''
  const mutexHeld = new Promise((resolve) =>
    mutex.stdout.on('data', (chunk) => {
      mutexOut += chunk
      if (mutexOut.includes('HELD')) resolve()
    })
  )
  mutex.stdin.write(
    "begin; select pg_advisory_xact_lock(hashtextextended('evolutus:status-expiration',0)); select 'HELD';\n"
  )
  await mutexHeld
  check(
    parse('select public.process_expired_statuses(50);').busy === true,
    'concurrent worker returns busy without deleting'
  )
  mutex.stdin.end('commit;\n')
  await once(mutex, 'exit')
  const silent = { log() {}, error() {} }
  check(
    (await processStorageCleanup(admin, silent)).cleanupQueued === 0,
    'AUD04 preserves image with another live reference'
  )
  check(
    !!good(await admin.storage.from('status-photos').download(`${community}/${photo}.webp`)),
    'shared photo bytes remain in Storage'
  )
  sql(`delete from public.statuses where id='${shared}';`)
  const fakeFailure = {
    rpc: (...a) => admin.rpc(...a),
    storage: { from: () => ({ remove: async () => ({ error: { status: 503 } }) }) },
  }
  const log = { log() {}, error() {} }
  const failed = await processStorageCleanup(fakeFailure, log)
  check(
    failed.cleanupErrored === 1 && failed.cleanupCompleted === 0,
    'partial Storage failure durable and retryable'
  )
  sql(`update public.storage_cleanup_tasks set next_attempt_at=now() where source_id='${photo}';`)
  const cleaned = await processStorageCleanup(admin, log)
  check(
    cleaned.cleanupCompleted === 1 && cleaned.cleanupErrored === 0,
    'AUD04 worker physically removes expired image after retry'
  )
  check(
    !!(await admin.storage.from('status-photos').download(`${community}/${photo}.webp`)).error,
    'expired image absent from real local Storage'
  )
  check(
    !!good(await admin.storage.from('status-photos').download(`${community}/${paidPhoto}.webp`)),
    'paid photo bytes preserved'
  )
  check((await processStorageCleanup(admin, log)).cleanupQueued === 0, 'Storage cleanup idempotent')
  // Natural promotion expiry revalidates even if the cached flags still claim it is active.
  sql(
    `update public.promotions set expires_at=now()-interval '1 second' where target_id='${paidPhoto}';`
  )
  check(
    parse('select public.process_expired_statuses(50);').deleted === 1,
    'promotion expiry makes photo eligible automatically'
  )
  check(
    (await processStorageCleanup(admin, log)).cleanupCompleted === 1,
    'photo cleaned after promotion expires'
  )
  check(
    sql(`select count(*) from public.promotions where target_id='${paidPhoto}';`) === '1',
    'financial promotion history survives cleanup'
  )
  console.log(`PASS ${checks} integration/concurrency checks`)
} finally {
  sql('update public.status_expiration_control set enabled=false;')
  for (const q of originalQueue)
    sql(
      `update public.status_expiration_queue set next_attempt_at='${q.next_attempt_at}' where status_id='${q.status_id}';`
    )
  for (const t of originalTasks)
    sql(
      `update public.storage_cleanup_tasks set next_attempt_at='${t.next_attempt_at}' where id='${t.id}';`
    )
  await new Promise((resolve) => gateway.close(resolve))
}

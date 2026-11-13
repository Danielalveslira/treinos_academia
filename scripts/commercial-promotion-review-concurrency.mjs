// Real concurrency for admin_review_commercial_promotion (PR0): two genuinely separate
// `psql` processes/connections racing the same `for update` lock, not two sequential calls
// inside one pgTAP transaction (which only proves the optimistic-concurrency arithmetic, not
// that the database actually serializes concurrent decisions -- see the header comment on the
// `sql` job in .github/workflows/supabase-tests.yml for why this lives here, not in
// supabase/tests/*_test.sql). Synthetic fixtures in an allowlisted disposable PostgreSQL only.
// No remote URL, no real money.
import { verifyLocalPostgresImage } from './homolog/finance/images.mjs'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const container = process.env.PG_TEST_CONTAINER || 'supabase_db_treinos_academia'
if (
  ![
    'supabase_db_treinos_academia',
    'evolutus_price_phase1_db',
    'evolutus_integrated_db',
    'evolutus_release_ci_db',
  ].includes(container)
)
  throw Error('DISPOSABLE_DATABASE_REQUIRED')
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0]
verifyLocalPostgresImage(info)

const execute = promisify(execFile)
const q = (value) => `'${String(value).replaceAll("'", "''")}'`
async function sql(source) {
  const { stdout } = await execute('docker', [
    'exec',
    '-i',
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
  return (
    stdout
      .trim()
      .split('\n')
      .filter((x) => x.startsWith('{'))
      .at(-1) || stdout.trim()
  )
}

const admin = randomUUID(),
  owner = randomUUID()
const sessions = new Map([admin, owner].map((x) => [x, randomUUID()]))
const claims = (user, recent = false) =>
  `select set_config('request.jwt.claim.sub',${q(user)},true);select set_config('request.jwt.claims',${q(
    JSON.stringify({
      sub: user,
      role: 'authenticated',
      session_id: sessions.get(user),
      ...(recent
        ? { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] }
        : {}),
    })
  )},true);set local role authenticated;`
const asUser = (user, source, recent = false) =>
  sql(`begin;${claims(user, recent)}${source};commit;`)
const asAdmin = (source) => asUser(admin, source, true)

for (const user of [admin, owner])
  await sql(
    `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values(${q(user)},'authenticated','authenticated',${q(user + '@example.invalid')},'x',now(),'{}','{}',now(),now());insert into auth.sessions(id,user_id,created_at,updated_at)values(${q(sessions.get(user))},${q(user)},now(),now())`
  )
await sql(
  `update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now() from public.legal_policy p where p.id and p.published and u.id in(${q(admin)},${q(owner)});update public.users set role='superadmin' where id=${q(admin)}`
)

// One fresh, independent community per racing scenario -- prepare_commercial_promotion
// replays the existing resource for (owner,type,target), so each scenario needs its own
// target to get its own 'submitted' resource at revision 1.
async function newCommunity() {
  const id = randomUUID()
  await sql(
    `insert into public.communities(id,name,created_by,owner_id)values(${q(id)},'Synthetic PR0 concurrency',${q(owner)},${q(owner)});insert into public.community_members(community_id,user_id)values(${q(id)},${q(owner)})`
  )
  await asUser(owner, `select public.configure_community_advertising(${q(id)},false,true,0)`)
  const prepared = JSON.parse(
    await asUser(owner, `select public.prepare_commercial_promotion('community',${q(id)})`)
  )
  return prepared.resourceId
}

const review = (resourceId, revision, approve, reason) =>
  asAdmin(
    `select public.admin_review_commercial_promotion(${q(resourceId)},${revision},${approve},${q(reason)})`
  )

// Scenario 1: two admins who both loaded the queue at revision 1 decide oppositely at the
// same instant. Postgres' row lock must let only one through; the other must fail with
// PROMOTION_REVISION_CONFLICT, never silently flip the winner's decision.
{
  const resourceId = await newCommunity()
  const race = await Promise.allSettled([
    review(resourceId, 1, true, 'Concurrent approval A'),
    review(resourceId, 1, false, 'Concurrent rejection B'),
  ])
  assert.equal(
    race.filter((r) => r.status === 'fulfilled').length,
    1,
    'exactly one opposing decision wins the race'
  )
  assert.match(
    race.find((r) => r.status === 'rejected').reason.stderr,
    /PROMOTION_REVISION_CONFLICT/,
    'the loser fails with the revision/state conflict, not a generic or silent error'
  )
  const finalState = await sql(
    `select moderation_state from private.commercial_resources where id=${q(resourceId)}`
  )
  assert.ok(
    ['approved', 'rejected'].includes(finalState),
    'final state matches a real decision, not a hybrid/corrupted one'
  )
  const auditCount = await sql(
    `select count(*) from public.advertising_operations where resource_id=${q(resourceId)} and action in('approve_promotion','reject_promotion')`
  )
  assert.equal(
    auditCount,
    '1',
    'exactly one audited decision survives the race, never both nor neither'
  )
}

// Scenario 2: two admins race the SAME decision (both approve). Even full agreement must not
// let the second writer re-run the mutation/audit insert -- only the first commit counts.
{
  const resourceId = await newCommunity()
  const race = await Promise.allSettled([
    review(resourceId, 1, true, 'Concurrent approval A'),
    review(resourceId, 1, true, 'Concurrent approval B'),
  ])
  assert.equal(
    race.filter((r) => r.status === 'fulfilled').length,
    1,
    'exactly one of two identical concurrent approvals wins'
  )
  assert.match(
    race.find((r) => r.status === 'rejected').reason.stderr,
    /PROMOTION_REVISION_CONFLICT/,
    'the second identical approval is rejected, not silently accepted as a harmless duplicate'
  )
  const auditCount = await sql(
    `select count(*) from public.advertising_operations where resource_id=${q(resourceId)} and action='approve_promotion'`
  )
  assert.equal(
    auditCount,
    '1',
    'agreeing concurrent admins still produce exactly one audit row, never a duplicate'
  )
}

// The vulnerable 3-argument signature was dropped in the same migration that added the
// concurrency guard (20261217000001): no client, old or new, can reach a decision path that
// skips the expected-revision/state check.
{
  const resourceId = await newCommunity()
  await assert.rejects(
    asAdmin(
      `select public.admin_review_commercial_promotion(${q(resourceId)},true,'Old 3-argument signature')`
    ),
    /function public\.admin_review_commercial_promotion\(.*\) does not exist/,
    'the pre-fix 3-argument signature no longer exists -- there is no bypass path left'
  )
  const stillSubmitted = await sql(
    `select moderation_state from private.commercial_resources where id=${q(resourceId)}`
  )
  assert.equal(stillSubmitted, 'submitted', 'the failed legacy call never mutated the resource')
}

const result = {
  localOnly: true,
  container,
  opposingDecisionRace: true,
  agreeingDecisionRace: true,
  legacySignatureRemoved: true,
}
console.log(JSON.stringify(result))

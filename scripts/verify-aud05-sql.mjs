// Local rollback-only regression; isolates operational queues and supplies current legal acceptance to old fixtures.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
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
  '-v',
  'ON_ERROR_STOP=1',
]
assert.equal(
  execFileSync(
    'docker',
    [...args, '-At', '-c', "select current_setting('cron.launch_active_jobs')"],
    { encoding: 'utf8' }
  ).trim(),
  'off'
)
const dir = '/tmp/aud05/sql'
await mkdir(dir, { recursive: true })
const results = []
for (const name of [
  'aud_01_aud_02_security_test',
  'community_promotion_security_test',
  'account_deletion_financial_case_test',
  'account_deletion_hardening_test',
  'financial_case_retention_test',
  'financial_case_cancel_traceability_test',
  'infinitepay_cash_purchases_test',
  'comments_system_test',
  'post_support_reactions_test',
  'support_moderation_functions_test',
  'status_text_limit_test',
  'status_progress_metadata_test',
  'feed_security_test',
  'status_expiration_test',
  'aud05_status_deletion_test',
]) {
  let input = await readFile(`supabase/tests/${name}.sql`, 'utf8')
  if (name === 'account_deletion_hardening_test')
    input = input.replace(
      'begin;',
      "begin;\nupdate public.deletion_jobs set state='cancelled' where state in ('pending','auth_cleanup');"
    )
  if (name === 'status_expiration_test') {
    input = input
      .replace('begin;', 'begin;\ndelete from public.status_expiration_queue;')
      .replace(
        'where p.target_id=s.id;',
        "where p.target_id=s.id and s.community_id='85000000-0000-0000-0000-000000000001';"
      )
      .replaceAll(
        'from public.statuses)',
        "from public.statuses where community_id='85000000-0000-0000-0000-000000000001')"
      )
      .replaceAll(
        'from public.post_comments)',
        'from public.post_comments where status_id in (select id from fixture))'
      )
      .replaceAll(
        'from public.status_votes)',
        'from public.status_votes where status_id in (select id from fixture))'
      )
      .replaceAll(
        'from public.status_participants)',
        'from public.status_participants where status_id in (select id from fixture))'
      )
      .replace(
        "update public.support_requests set state='closed';",
        "update public.support_requests set state='closed' where user_id='84000000-0000-0000-0000-000000000002';"
      )
      .replace(
        'from public.support_requests)',
        "from public.support_requests where user_id='84000000-0000-0000-0000-000000000002')"
      )
  }
  if (name === 'post_support_reactions_test')
    input = input.replace(
      'insert into public.public_profiles',
      "update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now() from public.legal_policy p where p.id and p.published and u.id::text like '68000000-%';\ninsert into public.public_profiles"
    )
  if (name === 'status_progress_metadata_test')
    input = input.replaceAll(
      'where progress_kind is not null)',
      "where progress_kind is not null and author_id='91000000-0000-0000-0000-000000000001')"
    )
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  const output = (result.stdout || '') + (result.stderr || '')
  await writeFile(`${dir}/${name}.log`, output)
  assert.equal(result.status, 0, `${name}: SQL failed; inspect ${dir}/${name}.log`)
  assert.equal(
    /not ok|Looks like you failed|ERROR:/.test(output),
    false,
    `${name}: pgTAP failed; inspect ${dir}/${name}.log`
  )
  const plan = output.match(/1\.\.([0-9]+)/)
  assert.ok(plan, `${name}: missing pgTAP plan`)
  results.push({ name, passed: Number(plan[1]) })
  console.log(`PASS ${name} ${plan[0]}`)
}
await writeFile(
  '/tmp/aud05/sql-results.json',
  JSON.stringify(
    { localOnly: true, results, passed: results.reduce((n, r) => n + r.passed, 0) },
    null,
    2
  )
)

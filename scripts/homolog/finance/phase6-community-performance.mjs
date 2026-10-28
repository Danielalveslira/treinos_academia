// Real local query plan; synthetic communities are rolled back, never published.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const access = JSON.parse(readFileSync('.finance-local/phase6-access.json'))
const claims = JSON.parse(Buffer.from(access.viewer.access_token.split('.')[1], 'base64url'))
const escapedClaims = JSON.stringify(claims).replaceAll("'", "''")
function measure(batchedGate) {
  const sql = `begin;
alter policy communities_select on public.communities using (${batchedGate ? '(select public.has_app_access())' : 'public.has_app_access()'});
insert into public.communities(id,name,created_by)
select gen_random_uuid(),'Synthetic batch performance '||i,'${access.owner.user.id}' from generate_series(1,2000)i;
set local role authenticated;
do $$begin perform set_config('request.jwt.claims','${escapedClaims}',true);end$$;
explain(analyze,buffers,format json) select id,name,verified_promoted_until from public.communities_with_promotions where is_active order by name limit 200;
rollback;`
  const raw = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'evolutus_price_phase1_db',
      'psql',
      '-XqAt',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: sql, encoding: 'utf8' }
  )
  return JSON.parse(raw)
}
const before = measure(false)
const plan = measure(true)
function find(node) {
  if (node['Function Name'] === 'community_advertising_windows') return node
  for (const child of node.Plans || []) {
    const match = find(child)
    if (match) return match
  }
}
const batch = find(plan[0].Plan)
assert.equal(batch?.['Actual Loops'], 1, 'paid eligibility must run once for the list')
assert.equal(plan[0].Plan['Actual Rows'], 200)
writeFileSync(
  'docs/finance-restructure/phase6/evidence/community-performance.json',
  JSON.stringify(
    {
      localOnly: true,
      syntheticRows: 2000,
      returnedRows: 200,
      paidEligibilityExecutions: batch['Actual Loops'],
      executionMs: plan[0]['Execution Time'],
      beforeExecutionMs: before[0]['Execution Time'],
      beforePlan: before,
      plan,
    },
    null,
    2
  ) + '\n'
)
console.log(
  JSON.stringify({
    returnedRows: 200,
    paidEligibilityExecutions: 1,
    executionMs: plan[0]['Execution Time'],
  })
)

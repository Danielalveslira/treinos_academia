// Actual PostgreSQL selection; no metrics, campaigns or financial data are written.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const a = JSON.parse(readFileSync('.finance-local/phase6-access.json'))
const claims = JSON.parse(Buffer.from(a.viewer.access_token.split('.')[1], 'base64url'))
const q = (value) => "'" + value.replaceAll("'", "''") + "'"
if (!/^[0-9a-f-]{36}$/.test(a.community)) throw Error('LOCAL_CONTEXT_REQUIRED')
const sql = `begin read only;set local statement_timeout='60s';set local role authenticated;
select set_config('request.jwt.claims',${q(JSON.stringify(claims))},true);
do $$declare placement text; chosen jsonb; counts jsonb; key text; i int;begin
 foreach placement in array array['home_banner','community_banner','community_feed'] loop
  counts:='{}';
  for i in 1..500 loop
   chosen:=public.select_advertising(placement,case when placement='home_banner' then null else '${a.community}'::uuid end);
   key:=coalesce(chosen->0->>'id','no_eligible_campaign');
   counts:=jsonb_set(counts,array[key],to_jsonb(coalesce((counts->>key)::int,0)+1));
  end loop;
  raise notice 'ROTATION_SAMPLE %',jsonb_build_object('placement',placement,'draws',500,'firstCandidateCounts',counts);
 end loop;
end$$;rollback;`
const result = spawnSync(
  'docker',
  [
    'exec',
    '-i',
    'evolutus_price_phase1_db',
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
  ],
  { input: sql, encoding: 'utf8', maxBuffer: 2e6 }
)
if (result.status !== 0) throw Error(result.stderr || 'ROTATION_QUERY_FAILED')
const samples = [...result.stderr.matchAll(/ROTATION_SAMPLE (\{.*\})/g)].map((m) =>
  JSON.parse(m[1])
)
if (
  samples.length !== 3 ||
  samples.some((s) => Object.values(s.firstCandidateCounts).reduce((a, b) => a + b, 0) !== 500)
)
  throw Error('ROTATION_SAMPLE_MISSING')
writeFileSync(
  'docs/finance-restructure/consolidation/evidence/rotation.json',
  JSON.stringify(
    {
      localOnly: true,
      syntheticInventory: true,
      audienceMetrics: false,
      statisticalGuarantee: false,
      samples,
    },
    null,
    2
  ) + '\n'
)
console.log(JSON.stringify(samples))

// Actual RPC and nested EXPLAIN ANALYZE, synthetic expired history; always rollback.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const a = JSON.parse(readFileSync('.finance-local/phase6-access.json'))
const claims = JSON.parse(Buffer.from(a.owner.access_token.split('.')[1], 'base64url'))
const count = Number(process.argv[2] || 10000)
if (![100, 1000, 10000].includes(count)) throw Error('SYNTHETIC_VOLUME_REQUIRED')
const index =
  'create index advertising_legacy_expiry_idx on public.sponsored_ads(expires_at) where commercial_resource_id is null;'
const bench = (stage) =>
  `set local role authenticated;create temp table bench_${stage}(ms numeric);do $$declare t timestamptz;i int;begin for i in 1..20 loop t:=clock_timestamp();perform public.select_advertising('home_banner',null);insert into bench_${stage} values(extract(epoch from clock_timestamp()-t)*1000);end loop;end$$;reset role;select '${stage}',percentile_cont(.5)within group(order by ms),percentile_cont(.95)within group(order by ms) from bench_${stage};set local auto_explain.log_min_duration='0ms';set local role authenticated;select public.select_advertising('home_banner',null);reset role;set local auto_explain.log_min_duration=-1;`
const source = `begin;drop index if exists public.advertising_legacy_expiry_idx;set local statement_timeout='90s';load 'auto_explain';set local auto_explain.log_level='notice';set local auto_explain.log_analyze=on;set local auto_explain.log_buffers=on;set local auto_explain.log_nested_statements=on;set local auto_explain.log_min_duration=-1;
insert into public.sponsored_ads(partner_name,title,is_global,display_mode,created_by,expires_at)select 'Synthetic expired advertiser','Synthetic expired inventory '||i,true,array['banner'],'${a.owner.user.id}',now()-interval '1 day' from generate_series(1,${count})i;
analyze public.sponsored_ads;analyze private.advertising_reservations;
select set_config('request.jwt.claim.sub','${a.owner.user.id}',true);select set_config('request.jwt.claims','${JSON.stringify(claims)}',true);
${bench('before')}${index}analyze public.sponsored_ads;${bench('after')}rollback;`
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
    '-XtA',
    '-v',
    'ON_ERROR_STOP=1',
  ],
  { input: source, encoding: 'utf8', maxBuffer: 20e6 }
)
writeFileSync(`docs/finance-restructure/phase6/evidence/performance-${count}.log`, result.stdout)
writeFileSync(
  `docs/finance-restructure/phase6/evidence/performance-plans-${count}.log`,
  result.stderr
)
if (result.status !== 0) throw Error(result.stderr)
console.log(
  result.stdout
    .split('\n')
    .filter((l) => /^before\||^after\|/.test(l))
    .join('\n')
)

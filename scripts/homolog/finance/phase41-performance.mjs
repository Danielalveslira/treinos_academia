import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const fixture = readFileSync('supabase/tests/product_storefronts_performance.sql', 'utf8').split(
  'explain(analyze,buffers)'
)[0]
const migration = [
  '20261202000001_storefront_editorial_revisions.sql',
  '20261202000002_storefront_media_maintenance_legacy.sql',
]
  .map((f) => readFileSync('supabase/migrations/' + f, 'utf8'))
  .join('\n')
const benchmark = (label) => `
create temp table bench_${label}(operation text,ms numeric);
do $$declare op text;t timestamptz;i integer;begin
 foreach op in array array['groups','items','categories','detail','product'] loop
 for i in 1..8 loop
 t:=clock_timestamp();perform public.public_product_catalog(op,case when op='items' then 'Synthetic' else '' end,case when op='items' then 'Fitness' else '' end,case when op='detail' then md5('sf-perf-store:500')::uuid::text when op='product' then(select id::text from public.partner_products where storefront_id=md5('sf-perf-store:500')::uuid order by id limit 1) else '' end,0,case when op='groups' then 5 else 20 end);
 insert into bench_${label} values(op,extract(epoch from clock_timestamp()-t)*1000);end loop;end loop;end$$;
select '${label}' as stage,operation,round(percentile_cont(0.5) within group(order by ms)::numeric,3) p50_ms,round(percentile_cont(0.95) within group(order by ms)::numeric,3) p95_ms from bench_${label} group by operation order by operation;
-- Capture the nested SQL, not only the opaque PL/pgSQL Result node.
set local auto_explain.log_min_duration='3ms';
do $$begin raise notice 'PLAN STAGE ${label}';end$$;
explain(analyze,buffers) select public.public_product_catalog('groups','','','',0,5);
explain(analyze,buffers) select public.public_product_catalog('items','Synthetic','Fitness','',0,20);
explain(analyze,buffers) select public.public_product_catalog('categories');
explain(analyze,buffers) select public.public_product_catalog('detail','','',md5('sf-perf-store:500')::uuid::text,0,20);
explain(analyze,buffers) select public.public_product_catalog('product','','',(select id::text from public.partner_products where storefront_id=md5('sf-perf-store:500')::uuid order by id limit 1),0,1);
set local auto_explain.log_min_duration=-1;
`
const volume = Number(process.argv[2] || 1000)
if (![100, 1000].includes(volume)) throw Error('Synthetic volume required')
const baseline =
  'begin;' + readFileSync('supabase/migrations/20261201000001_product_storefronts.sql', 'utf8')
const sql =
  baseline +
  `load 'auto_explain';set local auto_explain.log_level='notice';set local auto_explain.log_analyze=on;set local auto_explain.log_buffers=on;set local auto_explain.log_timing=off;set local auto_explain.log_nested_statements=on;` +
  fixture
    .replace('begin;', '')
    .replace('generate_series(1,1000)', 'generate_series(1,' + volume + ')')
    .replace('generate_series(1,10000)', 'generate_series(1,' + volume * 10 + ')') +
  benchmark('before') +
  migration +
  `analyze public.storefront_publications;analyze public.storefront_published_products;` +
  benchmark('after') +
  `
explain(analyze,buffers) select p.product_id from public.storefront_published_products p join private.live_storefronts s on s.storefront_id=p.storefront_id where s.storefront_id=md5('sf-perf-store:500')::uuid order by p.display_order,p.product_id limit 20;
rollback;`
const result = spawnSync(
  'docker',
  [
    'exec',
    '-i',
    'evolutus_commercial_phase0_20261027',
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
  ],
  {
    input: sql.replaceAll('sf-perf-store:500', 'sf-perf-store:' + Math.min(500, volume)),
    encoding: 'utf8',
    maxBuffer: 16000000,
  }
)
if (result.error || result.status !== 0) throw result.error || Error(result.stderr)
const output = result.stdout
mkdirSync('docs/finance-restructure/phase4/evidence41', { recursive: true })
writeFileSync(
  'docs/finance-restructure/phase4/evidence41/performance-paired-' + volume + '.log',
  output
)
writeFileSync(
  'docs/finance-restructure/phase4/evidence41/performance-nested-plans-' + volume + '.log',
  result.stderr
)
console.log(
  output
    .split('\n')
    .filter((s) => /before\s+\||after\s+\||Execution Time/.test(s))
    .join('\n')
)
